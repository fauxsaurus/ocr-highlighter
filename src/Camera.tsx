import {useRef, useState} from 'react'

export const Camera = () => {
	const [imageSrc, setImageSrc] = useState<string | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const [cameraActive, setCameraActive] = useState<boolean>(false)
	const videoRef = useRef<HTMLVideoElement | null>(null)

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
	}

	return (
		<>
			{!cameraActive ? (
				<button onClick={startCamera}>Use Camera</button>
			) : (
				<button onClick={stopCamera}>
					<span>Close Camera</span>
				</button>
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
		</>
	)
}
