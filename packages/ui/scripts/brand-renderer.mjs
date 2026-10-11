// Runs inside Chromium. Geometry comes from the shared interactive logo grid.
export function renderBrandAssets({ letter, word }) {
  const makeCanvas = (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const bounds = (canvas) => {
    const { width, height } = canvas;
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, width, height).data;
    const box = { left: width, top: height, right: 0, bottom: 0 };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] <= 16) {
          continue;
        }
        box.left = Math.min(box.left, x);
        box.top = Math.min(box.top, y);
        box.right = Math.max(box.right, x + 1);
        box.bottom = Math.max(box.bottom, y + 1);
      }
    }
    return box;
  };
  const assets = {};
  let pointerY = 0.3;
  const drawStrokeCharacters = (context, lines, left, top, cellWidth, unit) => {
    for (const [y, line] of lines.entries()) {
      for (const [x, char] of [...line].entries()) {
        if (char !== "█" && char !== " ") {
          context.fillText(
            char,
            left + x * cellWidth,
            top + y * unit,
            cellWidth
          );
        }
      }
    }
  };
  const filledCells = (lines) => {
    const cells = [];
    for (const [y, line] of lines.entries()) {
      for (const [x, char] of [...line].entries()) {
        if (char === "█") {
          cells.push([x, y]);
        }
      }
    }
    return cells;
  };
  const shadeFace = (faceContext, { simple, ink, top, rows, unit }) => {
    if (simple) {
      faceContext.fillStyle = ink;
    } else {
      const gradient = faceContext.createLinearGradient(
        0,
        top,
        0,
        top + rows * unit
      );
      for (let index = 0; index <= 40; index++) {
        const position = index / 40;
        const light = Math.exp(
          -0.5 * ((position - (pointerY * 6) / 5) / 0.23) ** 2
        );
        const value = Math.round(
          ink === "white" ? 164 + 91 * light : 72 - 52 * light
        );
        gradient.addColorStop(position, `rgb(${value},${value},${value})`);
      }
      faceContext.fillStyle = gradient;
    }
  };
  const render = ({
    lines,
    width,
    height,
    content,
    ink = "white",
    simple = false,
  }) => {
    const cells = filledCells(lines);
    const columns = Math.max(...cells.map(([x]) => x)) + 1;
    const rows = Math.max(...cells.map(([, y]) => y)) + 1;
    const unit = Math.min(
      (width * content) / (columns * 0.6),
      (height * content) / rows
    );
    const cellWidth = unit * 0.6;
    const left = (width - columns * cellWidth) / 2;
    const top = (height - rows * unit) / 2;
    const mask = makeCanvas(width, height);
    const maskContext = mask.getContext("2d");
    maskContext.fillStyle = "white";
    maskContext.beginPath();
    for (const [x, y] of cells) {
      const x1 = left + x * cellWidth;
      const y1 = top + y * unit;
      if (simple) {
        // Native-size marks use integer edges rather than downsampled glow.
        maskContext.rect(
          Math.round(x1),
          Math.round(y1),
          Math.round(x1 + cellWidth) - Math.round(x1),
          Math.round(y1 + unit) - Math.round(y1)
        );
      } else {
        maskContext.rect(x1, y1, cellWidth, unit);
      }
    }
    if (simple) {
      // Widen only the two side projections by 25% of a cell. The top,
      // bottom, and inner opening retain the established silhouette.
      const extension = cellWidth * 0.25;
      maskContext.rect(
        Math.round(left - extension),
        Math.round(top + unit),
        Math.round(left + cellWidth) - Math.round(left - extension),
        Math.round(top + unit * 4) - Math.round(top + unit)
      );
      maskContext.rect(
        Math.round(left + (columns - 1) * cellWidth),
        Math.round(top + unit),
        Math.round(left + columns * cellWidth + extension) -
          Math.round(left + (columns - 1) * cellWidth),
        Math.round(top + unit * 4) - Math.round(top + unit)
      );
    }
    maskContext.fill();
    const face = makeCanvas(width, height);
    const faceContext = face.getContext("2d");
    faceContext.drawImage(mask, 0, 0);
    faceContext.globalCompositeOperation = "source-in";
    shadeFace(faceContext, { simple, ink, top, rows, unit });
    faceContext.fillRect(0, 0, width, height);
    const strokes = makeCanvas(width, height);
    const strokeContext = strokes.getContext("2d");
    if (!simple) {
      strokeContext.font = `${unit}px Menlo`;
      strokeContext.textBaseline = "top";
      const strokeTone = ink === "white" ? "#646464" : "#a0a0a0";
      strokeContext.fillStyle = strokeTone;
      drawStrokeCharacters(strokeContext, lines, left, top, cellWidth, unit);
      strokeContext.globalCompositeOperation = "destination-out";
      strokeContext.drawImage(mask, 0, 0);
    }
    const silhouette = makeCanvas(width, height);
    const silhouetteContext = silhouette.getContext("2d");
    silhouetteContext.drawImage(strokes, 0, 0);
    silhouetteContext.drawImage(mask, 0, 0);
    const box = bounds(silhouette);
    // Retain 92% of the complete-outline horizontal correction. The bright
    // face has more visual weight, so shift slightly right of equal margins.
    const dx = simple ? 0 : ((width - box.left - box.right) / 2) * 0.92;
    const dy = simple ? 0 : ((height - box.top - box.bottom) / 2) * 0.4;
    const result = makeCanvas(width, height);
    const context = result.getContext("2d");
    context.translate(dx, dy);
    if (!simple && ink === "white") {
      context.save();
      context.globalAlpha = 0.38;
      context.filter = `blur(${unit * 0.23}px)`;
      context.drawImage(face, 0, 0);
      context.restore();
    }
    context.drawImage(strokes, 0, 0);
    context.drawImage(face, 0, 0);
    return { canvas: result };
  };
  const background = (canvas, color) => {
    const result = makeCanvas(canvas.width, canvas.height);
    const context = result.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, result.width, result.height);
    context.drawImage(canvas, 0, 0);
    return result;
  };
  const save = (name, canvas) => {
    assets[name] = canvas.toDataURL(
      name.endsWith(".jpg") ? "image/jpeg" : "image/png",
      0.96
    );
  };
  const generateLetter = () => {
    for (const size of [128, 256, 512, 1024]) {
      const white = render({
        lines: letter,
        width: size,
        height: size,
        content: 0.58,
      });
      save(`openmeld-letter-o-glow-${size}.png`, white.canvas);
      save(
        `openmeld-letter-o-glow-black-${size}.jpg`,
        background(white.canvas, "#080808")
      );
      if (size === 1024) {
        save(
          "openmeld-letter-o-dark-1024.png",
          background(white.canvas, "#080808")
        );
        const dark = render({
          lines: letter,
          width: size,
          height: size,
          content: 0.58,
          ink: "black",
        });
        save("openmeld-letter-o-ink-1024.png", dark.canvas);
        save(
          "openmeld-letter-o-light-1024.png",
          background(dark.canvas, "#f5f5f5")
        );
        // Native icon owns its rounded tile and transparent outside padding.
        const native = makeCanvas(1024, 1024);
        const context = native.getContext("2d");
        context.fillStyle = "#080808";
        context.beginPath();
        context.roundRect(64, 64, 896, 896, 200);
        context.fill();
        context.drawImage(white.canvas, 64, 64, 896, 896);
        save("openmeld-desktop-1024.png", native);
      }
    }
  };
  const generateWordmark = () => {
    for (const ink of ["white", "black"]) {
      const mark = render({
        lines: word,
        width: 2400,
        height: 560,
        content: 0.86,
        ink,
      });
      save(
        `openmeld-wordmark-${ink === "white" ? "glow" : "ink"}-2400.png`,
        mark.canvas
      );
      save(
        `openmeld-wordmark-${ink === "white" ? "dark" : "light"}-2400.png`,
        background(mark.canvas, ink === "white" ? "#080808" : "#f5f5f5")
      );
    }
  };
  const generateSmallMarks = () => {
    for (const size of [16, 18, 32, 36, 48, 64, 128, 1024]) {
      for (const ink of ["white", "black"]) {
        const mark = render({
          lines: letter,
          width: size,
          height: size,
          content: 0.75,
          ink,
          simple: true,
        });
        save(`openmeld-letter-o-mono-${ink}-${size}.png`, mark.canvas);
      }
    }
  };
  const generateFavicons = () => {
    for (const size of [16, 32, 48]) {
      const mark = render({
        lines: letter,
        width: size,
        height: size,
        content: 0.75,
        simple: true,
      });
      save(`openmeld-favicon-${size}.png`, background(mark.canvas, "#080808"));
    }
  };
  const generate = () => {
    generateLetter();
    generateWordmark();
    generateSmallMarks();
    generateFavicons();
    const social = background(makeCanvas(1200, 630), "#080808");
    const socialWord = render({
      lines: word,
      width: 1200,
      height: 630,
      content: 0.78,
    });
    social.getContext("2d").drawImage(socialWord.canvas, 0, 0);
    save("openmeld-social-1200x630.png", social);
    document.getElementById("exports").textContent = JSON.stringify({
      assets,
    });
  };
  // The capture drives the same normalized pointer coordinate as the study.
  document.addEventListener(
    "pointermove",
    (event) => {
      pointerY = event.clientY / 1000;
      generate();
    },
    { once: true }
  );
  document.dispatchEvent(new PointerEvent("pointermove", { clientY: 300 }));
}
