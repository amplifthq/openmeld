const ASCII_RAMP = ["·", ":", "-", "=", "+", "*", "#", "%", "@"] as const;
const COLLABORATION_LOOP_MAJOR_RADIUS = 1.38;
const TAU = Math.PI * 2;

export type LandingAsciiFrame = {
	color: string;
	context: CanvasRenderingContext2D;
	fontFamily: string;
	height: number;
	pointerX: number;
	pointerY: number;
	timeSeconds: number;
	width: number;
};

type ProjectedGlyph = {
	alpha: number;
	character: string;
	x: number;
	y: number;
	z: number;
};

type RotationTransform = {
	cosineX: number;
	cosineY: number;
	cosineZ: number;
	sineX: number;
	sineY: number;
	sineZ: number;
};

export function drawCollaborationLoop(frame: LandingAsciiFrame) {
	const { context, height, width } = frame;
	const compact = width < 640;
	const fontSize = clamp(width / 112, compact ? 6.5 : 7.5, 11);
	const scaleX = width * 0.3;
	const scaleY = height * 0.43;
	const centerX = width * 0.5;
	const centerY = height * 0.5;
	const rotationX = 0.73 + frame.pointerY * 0.07;
	const rotationY = -0.24 + frame.pointerX * 0.08;
	const rotationZ = -0.12;
	const rotationTransform = createRotationTransform(
		rotationX,
		rotationY,
		rotationZ
	);
	// Shift the visible twist without changing the strip's single half-twist topology.
	const twistPhase = -0.1 + frame.pointerX * 0.16 - frame.pointerY * 0.11;
	const progress = (frame.timeSeconds * 0.055) % 1;
	const glyphs: ProjectedGlyph[] = [];
	const longitudinalSteps = compact ? 72 : 92;
	const stripSteps = compact ? 7 : 9;

	for (
		let longitudinalIndex = 0;
		longitudinalIndex < longitudinalSteps;
		longitudinalIndex += 1
	) {
		const loopProgress = longitudinalIndex / longitudinalSteps;
		const angle = loopProgress * TAU;
		const cosineAngle = Math.cos(angle);
		const sineAngle = Math.sin(angle);
		const twistAngle = angle / 2 + twistPhase;
		const cosineTwist = Math.cos(twistAngle);
		const sineTwist = Math.sin(twistAngle);
		const packetInfluence = Math.max(
			circularPulse(loopProgress, progress, 0.065),
			circularPulse(loopProgress, wrapProgress(progress + 0.34), 0.055),
			circularPulse(loopProgress, wrapProgress(progress + 0.68), 0.06)
		);
		const nodeInfluence = Math.max(
			circularPulse(loopProgress, 0, 0.035),
			circularPulse(loopProgress, 1 / 3, 0.035),
			circularPulse(loopProgress, 2 / 3, 0.035)
		);

		for (let stripIndex = 0; stripIndex < stripSteps; stripIndex += 1) {
			const stripProgress = stripIndex / (stripSteps - 1);
			const stripPosition = (stripProgress - 0.5) * 1.0;
			const radius =
				COLLABORATION_LOOP_MAJOR_RADIUS + stripPosition * cosineTwist;
			const point = rotatePoint(
				{
					x: radius * cosineAngle,
					y: radius * sineAngle,
					z: stripPosition * sineTwist,
				},
				rotationTransform
			);
			const stripEdge = 1 - Math.abs(stripPosition) / 0.68;
			const depth = clamp((point.z + 1.25) / 2.5, 0, 1);
			const intensity = clamp(
				0.28 + depth * 0.3 + packetInfluence * 0.82 + nodeInfluence * 0.3,
				0,
				1
			);
			const characterIndex = Math.min(
				ASCII_RAMP.length - 1,
				Math.floor(intensity * ASCII_RAMP.length)
			);
			const perspective = 1 + point.z * 0.075;

			glyphs.push({
				alpha: clamp(
					0.25 + intensity * 0.78 + Math.max(0, stripEdge) * 0.09,
					0,
					1
				),
				character: ASCII_RAMP[characterIndex] ?? "·",
				x: centerX + point.x * scaleX * perspective,
				y: centerY + point.y * scaleY * 0.88 * perspective,
				z: point.z,
			});
		}
	}

	glyphs.sort((left, right) => left.z - right.z);
	context.clearRect(0, 0, width, height);
	context.fillStyle = frame.color;
	context.font = `500 ${fontSize}px ${frame.fontFamily}`;
	context.textAlign = "center";
	context.textBaseline = "middle";

	for (const glyph of glyphs) {
		context.globalAlpha = glyph.alpha;
		context.fillText(glyph.character, glyph.x, glyph.y);
	}

	context.globalAlpha = 1;
}

function rotatePoint(
	point: { x: number; y: number; z: number },
	transform: RotationTransform
) {
	const yAfterX = point.y * transform.cosineX - point.z * transform.sineX;
	const zAfterX = point.y * transform.sineX + point.z * transform.cosineX;
	const xAfterY = point.x * transform.cosineY + zAfterX * transform.sineY;
	const zAfterY = -point.x * transform.sineY + zAfterX * transform.cosineY;

	return {
		x: xAfterY * transform.cosineZ - yAfterX * transform.sineZ,
		y: xAfterY * transform.sineZ + yAfterX * transform.cosineZ,
		z: zAfterY,
	};
}

function createRotationTransform(
	rotationX: number,
	rotationY: number,
	rotationZ: number
): RotationTransform {
	return {
		cosineX: Math.cos(rotationX),
		cosineY: Math.cos(rotationY),
		cosineZ: Math.cos(rotationZ),
		sineX: Math.sin(rotationX),
		sineY: Math.sin(rotationY),
		sineZ: Math.sin(rotationZ),
	};
}

function circularPulse(value: number, center: number, radius: number) {
	const directDistance = Math.abs(value - center);
	const distance = Math.min(directDistance, 1 - directDistance);
	return Math.exp(-((distance / radius) ** 2));
}

function wrapProgress(value: number) {
	return ((value % 1) + 1) % 1;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
