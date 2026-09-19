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
		if (selection && selection.width > 0 && selection.height > 0) {
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
		}
	}, [selection])

	useEffect(() => {
		if (imageSrc) {
			drawCanvas()
		}
	}, [imageSrc, selection, drawCanvas])

	const handleImageLoad = () => {
		setSelection(null)
		setOcrText('')
		drawCanvas()
	}

	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file) {
			const url = URL.createObjectURL(file)
			setImageSrc(url)
			setCameraActive(false)
			setErrorMessage(null)
			setSelection(null)
			setOcrText('')
		}
	}

	const startCamera = async () => {
		setErrorMessage(null)
		try {
			setCameraActive(true)
			setImageSrc(null)
			const stream = await navigator.mediaDevices.getUserMedia({
				video: {facingMode: 'environment', width: {ideal: 1920}, height: {ideal: 1080}},
			})
			if (videoRef.current) {
				videoRef.current.srcObject = stream
			}
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
		if (ctx) {
			ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height)
			const dataUrl = tempCanvas.toDataURL('image/png')
			setImageSrc(dataUrl)
			stopCamera()
		}
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
		<div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col font-sans">
			{/* App Header */}
			<header className="border-b border-neutral-800 bg-neutral-950 px-6 py-4 flex items-center justify-between">
				<div className="flex items-center space-x-3">
					<div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg border border-blue-500/30">
						{/* Crop SVG Icon */}
						<svg
							className="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								d="M6 2v14a2 2 0 002 2h14M18 22V8a2 2 0 00-2-2H2"
							/>
						</svg>
					</div>
					<div>
						<h1 className="text-lg font-semibold text-neutral-100">
							OCR ROI Extractor
						</h1>
						<p className="text-xs text-neutral-400 hidden sm:block">
							Client-side Tesseract.js text extraction
						</p>
					</div>
				</div>

				{/* Action Controls */}
				<div className="flex items-center space-x-3">
					<input
						type="file"
						ref={fileInputRef}
						onChange={handleFileUpload}
						accept="image/*"
						className="hidden"
					/>

					<button
						onClick={() => fileInputRef.current?.click()}
						className="flex items-center space-x-2 px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-medium rounded-lg border border-neutral-700 transition-colors"
					>
						{/* Upload SVG Icon */}
						<svg
							className="w-4 h-4 text-neutral-400"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
							/>
						</svg>
						<span className="hidden sm:inline">Upload Image</span>
					</button>

					{!cameraActive ? (
						<button
							onClick={startCamera}
							className="flex items-center space-x-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
						>
							{/* Camera SVG Icon */}
							<svg
								className="w-4 h-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2"
									d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
								/>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2"
									d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
								/>
							</svg>
							<span className="hidden sm:inline">Use Camera</span>
						</button>
					) : (
						<button
							onClick={stopCamera}
							className="flex items-center space-x-2 px-3.5 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
						>
							{/* Close SVG Icon */}
							<svg
								className="w-4 h-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
							<span className="hidden sm:inline">Close Camera</span>
						</button>
					)}
				</div>
			</header>

			{/* Main Container */}
			<main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl w-full mx-auto">
				{/* Left Column: Image Canvas / Camera Viewport */}
				<section className="lg:col-span-2 flex flex-col bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden relative min-h-[480px]">
					{/* Error Banner */}
					{errorMessage && (
						<div className="absolute z-10 top-4 left-4 right-4 bg-red-900/70 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg flex items-center justify-between text-sm">
							<span className="flex items-center space-x-2">
								<svg
									className="w-5 h-5 text-red-400 shrink-0"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
								<span>{errorMessage}</span>
							</span>
							<button
								onClick={() => setErrorMessage(null)}
								className="text-red-300 hover:text-white"
							>
								<svg
									className="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>
					)}

					{/* Active Camera Live Preview */}
					{cameraActive && (
						<div className="flex-1 flex flex-col items-center justify-center p-4 bg-black">
							<video
								ref={videoRef}
								autoPlay
								playsInline
								onLoadedMetadata={e => e.currentTarget.play()}
								className="max-h-[60vh] w-auto rounded-lg shadow-lg border border-neutral-800 object-contain"
							/>
							<button
								onClick={capturePhoto}
								className="mt-6 flex items-center space-x-2 px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-full shadow-lg transition-transform hover:scale-105"
							>
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
									/>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
									/>
								</svg>
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
							className="hidden"
						/>
					)}

					{/* Active Drawing Canvas Workspace */}
					{!cameraActive && imageSrc && (
						<div className="flex-1 flex flex-col">
							<div className="flex-1 flex justify-center items-center p-4 bg-neutral-900/50 overflow-hidden">
								<canvas
									ref={canvasRef}
									onPointerDown={handlePointerDown}
									onPointerMove={handlePointerMove}
									onPointerUp={handlePointerUp}
									className="max-w-full max-h-[65vh] object-contain cursor-crosshair rounded shadow-sm border border-neutral-800 touch-none"
									style={{touchAction: 'none'}}
								/>
							</div>

							{/* Bottom Instructions Bar */}
							<div className="p-4 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between text-sm text-neutral-400">
								<span className="flex items-center gap-2">
									<svg
										className="w-4 h-4 text-blue-400 shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth="2"
											d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									Click and drag (or touch and drag) to draw a region box.
								</span>
								{selection && (
									<button
										onClick={() => {
											setSelection(null)
											setOcrText('')
										}}
										className="text-neutral-400 hover:text-white transition-colors text-xs underline"
									>
										Clear Region
									</button>
								)}
							</div>
						</div>
					)}

					{/* Empty Upload Prompt */}
					{!cameraActive && !imageSrc && (
						<div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-neutral-500">
							<div className="w-16 h-16 bg-neutral-900 rounded-full flex items-center justify-center mb-4 border border-neutral-800">
								<svg
									className="w-8 h-8 text-neutral-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
									/>
								</svg>
							</div>
							<h3 className="text-base font-medium text-neutral-300">
								No Image Loaded
							</h3>
							<p className="text-xs text-neutral-500 mt-1 max-w-sm">
								Upload an image or start your camera to capture text for OCR.
							</p>
						</div>
					)}
				</section>

				{/* Right Column: OCR Execution Controls & Result Window */}
				<section className="flex flex-col space-y-4">
					<div className="bg-neutral-950 border border-neutral-800 rounded-xl p-5 flex-1 flex flex-col">
						<div className="flex items-center justify-between pb-4 border-b border-neutral-800">
							<h2 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
								OCR Processing
							</h2>
							{selection ? (
								<span className="px-2.5 py-1 text-[10px] font-bold uppercase bg-blue-900/50 text-blue-300 border border-blue-800/50 rounded-full">
									Region Active
								</span>
							) : (
								<span className="px-2.5 py-1 text-[10px] font-bold uppercase bg-neutral-800 text-neutral-400 rounded-full">
									Full Frame
								</span>
							)}
						</div>

						<div className="py-5 space-y-4">
							<button
								onClick={runOCR}
								disabled={!imageSrc || isProcessing}
								className="w-full flex items-center justify-center space-x-2 py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-600 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg transition-colors shadow-md"
							>
								{isProcessing ? (
									<>
										<svg
											className="w-4 h-4 animate-spin"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
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
								<div className="space-y-1.5 bg-neutral-900 p-3 rounded-lg border border-neutral-800">
									<div className="flex justify-between text-xs font-medium text-neutral-400">
										<span className="truncate pr-2">{progressStatus}</span>
										<span>{progress}%</span>
									</div>
									<div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
										<div
											className="bg-blue-500 h-full transition-all duration-300 ease-out"
											style={{width: `${progress}%`}}
										/>
									</div>
								</div>
							)}
						</div>

						{/* Extracted Output Textbox */}
						<div className="flex-1 flex flex-col min-h-[220px] bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden">
							<div className="flex items-center justify-between px-4 py-2.5 bg-neutral-950 border-b border-neutral-800 text-xs font-medium text-neutral-400">
								<span>Extracted Text</span>
								{ocrText && (
									<button
										onClick={copyToClipboard}
										className="flex items-center space-x-1.5 text-blue-400 hover:text-blue-300 transition-colors"
									>
										{copied ? (
											<>
												<svg
													className="w-3.5 h-3.5 text-green-400"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														strokeWidth="2"
														d="M5 13l4 4L19 7"
													/>
												</svg>
												<span className="text-green-400">Copied</span>
											</>
										) : (
											<>
												<svg
													className="w-3.5 h-3.5"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														strokeWidth="2"
														d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
													/>
												</svg>
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
								className="w-full flex-1 p-4 bg-transparent text-sm font-mono text-neutral-200 placeholder-neutral-600 focus:outline-none resize-none leading-relaxed"
							/>
						</div>
					</div>
				</section>
			</main>
		</div>
	)
}
