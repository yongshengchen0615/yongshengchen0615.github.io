(function () {
  "use strict";

  var DEFAULT_SIZE = 720;
  var DEFAULT_FILL_COLOR = "#D9D6CC";
  var DEFAULT_TEXT_COLOR = "#0B3C2C";
  var DEFAULT_BORDER_COLOR = "#0B3C2C";
  var DEFAULT_SEPARATOR_COLOR = "rgba(243, 240, 231, 0.92)";
  var HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/i;
  var MAX_PIXEL_RATIO = 3;
  var MAX_BACKING_SIZE = 3072;

  function textColor(color) {
    var match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(
      String(color || "")
    );
    if (!match) return DEFAULT_TEXT_COLOR;

    var luminance =
      Number.parseInt(match[1], 16) * 0.299 +
      Number.parseInt(match[2], 16) * 0.587 +
      Number.parseInt(match[3], 16) * 0.114;
    return luminance < 145 ? "#FFFFFF" : DEFAULT_TEXT_COLOR;
  }

  function normalizeSize(value) {
    var size = Math.floor(Number(value));
    return Number.isFinite(size) && size >= 120 && size <= 2048
      ? size
      : DEFAULT_SIZE;
  }

  function normalizePixelRatio(value, size) {
    var ratio = Number(value);
    if (!Number.isFinite(ratio) || ratio < 1) ratio = 1;
    return Math.max(
      1,
      Math.min(MAX_PIXEL_RATIO, ratio, MAX_BACKING_SIZE / size)
    );
  }

  function createRenderPlan(prizeValues, optionsValue) {
    var prizes = Array.isArray(prizeValues) ? prizeValues : [];
    var options =
      optionsValue && typeof optionsValue === "object" ? optionsValue : {};
    var size = normalizeSize(options.size);
    var center = size / 2;
    var radius = center - 12;
    var sector = prizes.length ? (Math.PI * 2) / prizes.length : 0;
    var emptyLabel = String(options.emptyLabel || "未命名");

    return Object.freeze({
      size: size,
      center: center,
      radius: radius,
      separatorColor:
        String(options.separatorColor || "").trim() || DEFAULT_SEPARATOR_COLOR,
      borderColor:
        String(options.borderColor || "").trim() || DEFAULT_BORDER_COLOR,
      font: prizes.length > 8 ? "600 22px sans-serif" : "600 28px sans-serif",
      segments: Object.freeze(
        prizes.map(function (prizeValue, index) {
          var prize =
            prizeValue && typeof prizeValue === "object" ? prizeValue : {};
          var color = HEX_COLOR_PATTERN.test(String(prize.color || ""))
            ? String(prize.color).toUpperCase()
            : DEFAULT_FILL_COLOR;
          var start = -Math.PI / 2 + index * sector;
          return Object.freeze({
            color: color,
            textColor: textColor(color),
            label: String(prize.label || emptyLabel).slice(0, 10),
            start: start,
            end: start + sector,
            labelRotation: start + sector / 2,
          });
        })
      ),
    });
  }

  function configureCanvas(canvas, context, size, requestedRatio) {
    var ratio = normalizePixelRatio(requestedRatio, size);
    var backingSize = Math.round(size * ratio);
    if (canvas.width !== backingSize) canvas.width = backingSize;
    if (canvas.height !== backingSize) canvas.height = backingSize;

    if (typeof context.setTransform === "function") {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    } else {
      if (typeof context.resetTransform === "function") {
        context.resetTransform();
      }
      if (ratio !== 1 && typeof context.scale === "function") {
        context.scale(ratio, ratio);
      }
    }
    return ratio;
  }

  function draw(canvas, prizeValues, optionsValue) {
    if (!canvas || typeof canvas.getContext !== "function") return false;
    var context = canvas.getContext("2d");
    if (!context) return false;

    var options =
      optionsValue && typeof optionsValue === "object" ? optionsValue : {};
    var plan = createRenderPlan(prizeValues, options);
    configureCanvas(canvas, context, plan.size, options.pixelRatio);
    context.clearRect(0, 0, plan.size, plan.size);
    context.strokeStyle = plan.separatorColor;
    context.lineWidth = 5;
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.font = plan.font;

    plan.segments.forEach(function (segment) {
      context.beginPath();
      context.moveTo(plan.center, plan.center);
      context.arc(
        plan.center,
        plan.center,
        plan.radius,
        segment.start,
        segment.end
      );
      context.closePath();
      context.fillStyle = segment.color;
      context.fill();
      context.stroke();

      context.save();
      context.translate(plan.center, plan.center);
      context.rotate(segment.labelRotation);
      context.fillStyle = segment.textColor;
      context.fillText(segment.label, plan.radius - 44, 0);
      context.restore();
    });

    context.beginPath();
    context.arc(plan.center, plan.center, plan.radius, 0, Math.PI * 2);
    context.strokeStyle = plan.borderColor;
    context.lineWidth = 10;
    context.stroke();
    return true;
  }

  window.LotteryWheel = Object.freeze({
    draw: draw,
    createRenderPlan: createRenderPlan,
    textColor: textColor,
  });
})();
