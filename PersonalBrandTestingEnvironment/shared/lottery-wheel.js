(function () {
  "use strict";

  var DEFAULT_SIZE = 720;
  var DEFAULT_FILL_COLOR = "#D9D6CC";
  var DEFAULT_TEXT_COLOR = "#0B3C2C";
  var DEFAULT_BORDER_COLOR = "#0B3C2C";
  var DEFAULT_SEPARATOR_COLOR = "rgba(243, 240, 231, 0.92)";
  var HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/i;

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

  function draw(canvas, prizeValues, optionsValue) {
    if (!canvas || typeof canvas.getContext !== "function") return false;
    var context = canvas.getContext("2d");
    if (!context) return false;

    var prizes = Array.isArray(prizeValues) ? prizeValues : [];
    var options =
      optionsValue && typeof optionsValue === "object" ? optionsValue : {};
    var size = normalizeSize(options.size);
    var center = size / 2;
    var radius = center - 12;
    var sector = prizes.length ? (Math.PI * 2) / prizes.length : 0;

    canvas.width = size;
    canvas.height = size;
    context.clearRect(0, 0, size, size);

    prizes.forEach(function (prizeValue, index) {
      var prize =
        prizeValue && typeof prizeValue === "object" ? prizeValue : {};
      var color = HEX_COLOR_PATTERN.test(String(prize.color || ""))
        ? String(prize.color)
        : DEFAULT_FILL_COLOR;
      var start = -Math.PI / 2 + index * sector;

      context.beginPath();
      context.moveTo(center, center);
      context.arc(center, center, radius, start, start + sector);
      context.closePath();
      context.fillStyle = color;
      context.fill();
      context.strokeStyle =
        String(options.separatorColor || "").trim() ||
        DEFAULT_SEPARATOR_COLOR;
      context.lineWidth = 5;
      context.stroke();

      context.save();
      context.translate(center, center);
      context.rotate(start + sector / 2);
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.font =
        prizes.length > 8 ? "600 22px sans-serif" : "600 28px sans-serif";
      context.fillStyle = textColor(color);
      context.fillText(
        String(prize.label || options.emptyLabel || "未命名").slice(0, 10),
        radius - 44,
        0
      );
      context.restore();
    });

    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.strokeStyle =
      String(options.borderColor || "").trim() || DEFAULT_BORDER_COLOR;
    context.lineWidth = 10;
    context.stroke();
    return true;
  }

  function normalizeSize(value) {
    var size = Math.floor(Number(value));
    return Number.isFinite(size) && size >= 120 && size <= 2048
      ? size
      : DEFAULT_SIZE;
  }

  window.LotteryWheel = Object.freeze({
    draw: draw,
    textColor: textColor,
  });
})();
