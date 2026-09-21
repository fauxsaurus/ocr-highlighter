import React, {useState, useRef, useEffect, useCallback} from 'react'
import Tesseract from 'tesseract.js'
import './app.css'

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
	const [progressStatus, setProgressStatus] = useState<string>('') // Preparing image..., Loading tesseract core, Initializing tesseract, Loading language traineddata, Initializing api, Recognizing Text

	const [copied, setCopied] = useState<boolean>(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const canvasRef = useRef<HTMLCanvasElement | null>(null)
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
		setErrorMessage(null)
		setSelection(null)
		setOcrText('')
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

	const copyToClipboard = (text: string) => {
		if (!text) return
		navigator.clipboard.writeText(text)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<main>
			<div hidden={!errorMessage}>
				<span>{errorMessage}</span>
				<button onClick={() => setErrorMessage(null)}></button>
			</div>
			{isProcessing && (
				<header>
					<span>{progressStatus}</span>
					<span>{progress}%</span>
				</header>
			)}
			<section hidden={!!imageSrc}>
				<label className="max">
					<input type="file" accept="image/*" onChange={handleFileUpload} hidden />
					Upload Image
				</label>
				<footer>
					<label>
						<input
							type="file"
							accept="image/*"
							capture="environment"
							hidden
							onChange={handleFileUpload}
						/>
						Take Photo
					</label>
				</footer>
			</section>
			<section hidden={!imageSrc || !!ocrText}>
				{/* @todo make this the background and absolutely position the canvas over it for a highlighter overlay. */}
				<img
					ref={imageRef}
					src={imageSrc ?? undefined}
					alt="Source context"
					onLoad={handleImageLoad}
					hidden
				/>
				<div className="max">
					<canvas
						ref={canvasRef}
						onPointerDown={handlePointerDown}
						onPointerMove={handlePointerMove}
						onPointerUp={handlePointerUp}
						style={{touchAction: 'none'}}
					/>
				</div>

				<footer>
					<button onClick={() => setImageSrc(null)}>Clear Photo</button>
					<button
						disabled={!selection}
						onClick={() => {
							setSelection(null)
							setOcrText('')
						}}
					>
						Clear Region
					</button>

					<button onClick={runOCR} disabled={!imageSrc || isProcessing}>
						{isProcessing ? (
							<span>Extracting...</span>
						) : (
							<span> Extract {selection ? 'Highlighted' : 'All'} Text</span>
						)}
					</button>
				</footer>
			</section>
			<section hidden={!ocrText}>
				<output className="max">{ocrText}</output>
				<footer>
					<button onClick={() => setOcrText('')}>Cancel</button>
					<button onClick={() => copyToClipboard(ocrText)}>
						{copied ? 'Copied' : 'Copy'}
					</button>
					<button
						onClick={() =>
							copyToClipboard(ocrText.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/, ' '))
						}
					>
						{copied ? 'Copied' : 'Copy (without linebreaks)'}
					</button>
				</footer>
			</section>
		</main>
	)
}
