import React, {useState, useRef, useEffect, useCallback} from 'react'
import Tesseract from 'tesseract.js'

interface Region {
	x: number
	y: number
	width: number
	height: number
}

interface Point {
	x: number
	y: number
}

export default function App() {
	const [imageSrc, setImageSrc] = useState<string | null>(null)
	const [selection, setSelection] = useState<Region | null>(null)
	const [isDrawing, setIsDrawing] = useState<boolean>(false)
	const [startPoint, setStartPoint] = useState<Point | null>(null)

	const [ocrText, setOcrText] = useState<string>('')
	const [isProcessing, setIsProcessing] = useState<boolean>(false)
	const [progress, setProgress] = useState<number>(0)
	const [progressStatus, setProgressStatus] = useState<string>('')

	const [copied, setCopied] = useState<boolean>(false)
	const [cameraActive, setCameraActive] = useState<boolean>(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const imageRef = useRef<HTMLImageElement | null>(null)

	const drawCanvas = useCallback(() => {
		const canvas = canvasRef.current
		const img = imageRef.current

		if (!canvas || !img || !img.complete || img.naturalWidth === 0) return

		const ctx = canvas.getContext('2d')
		if (!ctx) return

		// Scale internal canvas resolution to match true image dimensions for 1:1 accuracy
		canvas.width = img.naturalWidth
		canvas.height = img.naturalHeight

		// Draw base image
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		ctx.drawImage(img, 0, 0)

		// Render highlight ROI bounding box if available
		if (!(selection && selection.width > 0 && selection.height > 0)) return

		// Dark overlay over non-selected image regions
		ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
		ctx.fillRect(0, 0, canvas.width, canvas.height)

		// Clear dark overlay inside the selection region
		ctx.clearRect(selection.x, selection.y, selection.width, selection.height)

		// Re-draw the original image content inside selection region for crisp clarity
		ctx.drawImage(
			img,
			selection.x,
			selection.y,
			selection.width,
			selection.height,
			selection.x,
			selection.y,
			selection.width,
			selection.height,
		)

		// Draw active ROI border
		ctx.strokeStyle = '#3b82f6'
		ctx.lineWidth = Math.max(3, Math.round(canvas.width / 350))
		ctx.strokeRect(selection.x, selection.y, selection.width, selection.height)

		// Soft fill tint inside highlighted region
		ctx.fillStyle = 'rgba(59, 130, 246, 0.15)'
		ctx.fillRect(selection.x, selection.y, selection.width, selection.height)
	}, [selection])

	useEffect(() => {
		if (imageSrc) drawCanvas()
	}, [imageSrc, selection, drawCanvas])

	const handleImageLoad = () => {
		setSelection(null)
		setOcrText('')
		drawCanvas()
	}

	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return

		const url = URL.createObjectURL(file)
		setImageSrc(url)
		setCameraActive(false)
		setErrorMessage(null)
		setSelection(null)
		setOcrText('')
	}

	const startCamera = async () => {
		setErrorMessage(null)
		try {
			setCameraActive(true)
			setImageSrc(null)
			const stream = await navigator.mediaDevices.getUserMedia({
				video: {facingMode: 'environment', width: {ideal: 1920}, height: {ideal: 1080}},
			})
			if (videoRef.current) videoRef.current.srcObject = stream
		} catch (err) {
			console.error('Camera error:', err)
			setErrorMessage('Unable to access camera. Please check device permissions.')
			setCameraActive(false)
		}
	}

	const stopCamera = () => {
		if (videoRef.current && videoRef.current.srcObject) {
			const stream = videoRef.current.srcObject as MediaStream
			stream.getTracks().forEach(track => track.stop())
			videoRef.current.srcObject = null
		}
		setCameraActive(false)
	}

	const capturePhoto = () => {
		if (!videoRef.current) return
		const video = videoRef.current
		const tempCanvas = document.createElement('canvas')

		tempCanvas.width = video.videoWidth || 1280
		tempCanvas.height = video.videoHeight || 720

		const ctx = tempCanvas.getContext('2d')
		if (!ctx) return

		ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height)
		const dataUrl = tempCanvas.toDataURL('image/png')
		setImageSrc(dataUrl)
		stopCamera()
	}

	const getCanvasCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current
		if (!canvas) return {x: 0, y: 0}

		const rect = canvas.getBoundingClientRect()
		const scaleX = canvas.width / rect.width
		const scaleY = canvas.height / rect.height

		const x = Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX))
		const y = Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY))

		return {x: Math.round(x), y: Math.round(y)}
	}

	const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!imageSrc) return
		e.currentTarget.setPointerCapture(e.pointerId)
		const coords = getCanvasCoordinates(e)
		setStartPoint(coords)
		setIsDrawing(true)
		setSelection({x: coords.x, y: coords.y, width: 0, height: 0})
	}

	const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!isDrawing || !startPoint) return
		const coords = getCanvasCoordinates(e)

		const x = Math.min(startPoint.x, coords.x)
		const y = Math.min(startPoint.y, coords.y)
		const width = Math.abs(coords.x - startPoint.x)
		const height = Math.abs(coords.y - startPoint.y)

		setSelection({x, y, width, height})
	}

	const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!isDrawing) return
		e.currentTarget.releasePointerCapture(e.pointerId)
		setIsDrawing(false)

		// Ignore tiny accidental taps (<10px width or height)
		if (selection && (selection.width < 10 || selection.height < 10)) {
			setSelection(null)
		}
	}

	const runOCR = async () => {
		if (!imageSrc || !imageRef.current) return

		setIsProcessing(true)
		setProgress(0)
		setProgressStatus('Preparing image...')
		setOcrText('')
		setErrorMessage(null)

		let cropCanvas: HTMLCanvasElement

		// Crop highlighted region or use full image if no ROI selected
		if (selection && selection.width > 10 && selection.height > 10) {
			cropCanvas = document.createElement('canvas')
			cropCanvas.width = selection.width
			cropCanvas.height = selection.height
			const ctx = cropCanvas.getContext('2d')
			if (ctx) {
				ctx.drawImage(
					imageRef.current,
					selection.x,
					selection.y,
					selection.width,
					selection.height,
					0,
					0,
					selection.width,
					selection.height,
				)
			}
		} else {
			cropCanvas = document.createElement('canvas')
			cropCanvas.width = imageRef.current.naturalWidth
			cropCanvas.height = imageRef.current.naturalHeight
			const ctx = cropCanvas.getContext('2d')
			if (ctx) {
				ctx.drawImage(imageRef.current, 0, 0)
			}
		}

		try {
			// Execute client-side OCR directly with Tesseract.js
			const result = await Tesseract.recognize(cropCanvas, 'eng', {
				logger: m => {
					if (m.status === 'recognizing text') {
						setProgress(Math.round(m.progress * 100))
						setProgressStatus(`Recognizing Text: ${Math.round(m.progress * 100)}%`)
					} else {
						setProgressStatus(m.status.charAt(0).toUpperCase() + m.status.slice(1))
					}
				},
			})

			const extractedText = result.data.text.trim()
			setOcrText(extractedText || 'No text recognized in selected area.')
		} catch (err) {
			console.error('OCR Processing Error:', err)
			setErrorMessage('OCR extraction failed. Please try highlighting a clearer region.')
		} finally {
			setIsProcessing(false)
		}
	}

	const copyToClipboard = () => {
		if (!ocrText) return
		navigator.clipboard.writeText(ocrText)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div>
			{/* App Header */}
			<header>
				{/* Action Controls */}
				<div>
					<input
						type="file"
						ref={fileInputRef}
						onChange={handleFileUpload}
						accept="image/*"
					/>

					<button onClick={() => fileInputRef.current?.click()}>
						<span>Upload Image</span>
					</button>

					{!cameraActive ? (
						<button onClick={startCamera}>Use Camera</button>
					) : (
						<button onClick={stopCamera}>
							<span>Close Camera</span>
						</button>
					)}
				</div>
			</header>

			{/* Main Container */}
			<main>
				{/* Left Column: Image Canvas / Camera Viewport */}
				<section>
					{/* Error Banner */}
					{errorMessage && (
						<div>
							<span>
								<span>{errorMessage}</span>
							</span>
							<button onClick={() => setErrorMessage(null)}></button>
						</div>
					)}

					{/* Active Camera Live Preview */}
					{cameraActive && (
						<div>
							<video
								ref={videoRef}
								autoPlay
								playsInline
								onLoadedMetadata={e => e.currentTarget.play()}
							/>
							<button onClick={capturePhoto}>
								<span>Take Snapshot</span>
							</button>
						</div>
					)}

					{/* Hidden HTMLImageElement for original dimensions reference */}
					{imageSrc && (
						<img
							ref={imageRef}
							src={imageSrc}
							alt="Source context"
							onLoad={handleImageLoad}
						/>
					)}

					{/* Active Drawing Canvas Workspace */}
					{!cameraActive && imageSrc && (
						<div>
							<div>
								<canvas
									ref={canvasRef}
									onPointerDown={handlePointerDown}
									onPointerMove={handlePointerMove}
									onPointerUp={handlePointerUp}
									style={{touchAction: 'none'}}
								/>
							</div>

							{/* Bottom Instructions Bar */}
							<div>
								<span>
									Click and drag (or touch and drag) to draw a region box.
								</span>
								{selection && (
									<button
										onClick={() => {
											setSelection(null)
											setOcrText('')
										}}
									>
										Clear Region
									</button>
								)}
							</div>
						</div>
					)}

					{/* Empty Upload Prompt */}
					{!cameraActive && !imageSrc && (
						<div>
							<div>{/* img icon */}</div>
							<h3>No Image Loaded</h3>
							<p>Upload an image or start your camera to capture text for OCR.</p>
						</div>
					)}
				</section>

				{/* Right Column: OCR Execution Controls & Result Window */}
				<section>
					<div>
						<div>
							<h2>OCR Processing</h2>
							{selection ? <span>Region Active</span> : <span>Full Frame</span>}
						</div>

						<div>
							<button onClick={runOCR} disabled={!imageSrc || isProcessing}>
								{isProcessing ? (
									<>
										<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth="2"
												d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
											/>
										</svg>
										<span>Extracting...</span>
									</>
								) : (
									<span>
										{selection
											? 'Recognize Highlighted Region'
											: 'Recognize Full Image'}
									</span>
								)}
							</button>

							{/* Tesseract Progress Indicator */}
							{isProcessing && (
								<div>
									<div>
										<span>{progressStatus}</span>
										<span>{progress}%</span>
									</div>
									<div>
										<div style={{width: `${progress}%`}} />
									</div>
								</div>
							)}
						</div>

						{/* Extracted Output Textbox */}
						<div>
							<div>
								<span>Extracted Text</span>
								{ocrText && (
									<button onClick={copyToClipboard}>
										{copied ? (
											<>
												<span>Copied</span>
											</>
										) : (
											<>
												<span>Copy</span>
											</>
										)}
									</button>
								)}
							</div>

							<textarea
								value={ocrText}
								readOnly
								placeholder="Extracted text will appear here after recognition..."
							/>
						</div>
					</div>
				</section>
			</main>
		</div>
	)
}
