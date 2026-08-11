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
	const scale = Math.min(width * (compact ? 0.4655 : 0.361), height * 0.456);
	const centerX = width * (compact ? 0.525 : 0.55);
	const centerY = height * 0.52;
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
			const stripPosition = (stripProgress - 0.5) * 1.32;
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
				x: centerX + point.x * scale * perspective,
				y: centerY + point.y * scale * 0.61 * perspective,
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

export function drawAgentActivityField(frame: LandingAsciiFrame) {
	const { context, height, width } = frame;
	const compact = width < 640;
	const cellSize = compact ? 12 : 14;
	const fontSize = compact ? 8 : 9;
	const laneCount = 5;
	const columnCount = Math.ceil(width / cellSize);
	const rowCount = Math.ceil(height / cellSize);

	context.clearRect(0, 0, width, height);
	context.fillStyle = frame.color;
	context.font = `500 ${fontSize}px ${frame.fontFamily}`;
	context.textAlign = "center";
	context.textBaseline = "middle";

	for (let row = 0; row < rowCount; row += 1) {
		for (let column = 0; column < columnCount; column += 1) {
			const noise = stableNoise(column, row);
			if (noise < 0.82) {
				continue;
			}

			context.globalAlpha = 0.055 + noise * 0.05;
			context.fillText(
				ASCII_RAMP[Math.floor(noise * 4)] ?? "·",
				column * cellSize + cellSize / 2,
				row * cellSize + cellSize / 2
			);
		}
	}

	for (let lane = 0; lane < laneCount; lane += 1) {
		const laneProgress =
			(frame.timeSeconds * (0.035 + lane * 0.004) + lane * 0.17) % 1;
		const laneSpacing = height / (laneCount + 0.25);
		const laneCenter = (laneCount - 1) / 2;
		const baseY = height / 2 + (lane - laneCenter) * laneSpacing;
		const amplitude = Math.min(18, height * 0.055);

		for (let column = 0; column <= columnCount; column += 1) {
			const x = column * cellSize;
			const normalizedX = x / Math.max(width, 1);
			const wave =
				Math.sin(normalizedX * TAU * (1.2 + lane * 0.08) + lane * 0.7) *
				amplitude;
			const packet = circularPulse(normalizedX, laneProgress, 0.07);
			const handoff = circularPulse(
				normalizedX,
				wrapProgress(laneProgress + 0.45),
				0.035
			);
			const intensity = clamp(0.16 + packet * 0.82 + handoff * 0.4, 0, 1);
			const characterIndex = Math.min(
				ASCII_RAMP.length - 1,
				Math.floor(intensity * ASCII_RAMP.length)
			);

			context.globalAlpha = 0.14 + intensity * 0.72;
			context.fillText(
				ASCII_RAMP[characterIndex] ?? "·",
				x,
				baseY + wave + Math.sin(frame.timeSeconds * 0.4 + column * 0.08) * 2
			);
		}
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

function stableNoise(x: number, y: number) {
	const raw = Math.sin(x * 12.9898 + y * 78.233) * 43_758.5453;
	return raw - Math.floor(raw);
}

function wrapProgress(value: number) {
	return ((value % 1) + 1) % 1;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
