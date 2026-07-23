(function (global) {
  "use strict";

  // A dependency-free QR encoder for the short, ASCII LIFF claim URLs used by
  // this project. It emits a fixed Version 5 / error-correction L symbol,
  // whose byte-mode payload limit is 106 UTF-8 bytes.
  var VERSION = 5;
  var SIZE = 17 + VERSION * 4;
  var DATA_CODEWORDS = 108;
  var ERROR_CODEWORDS = 26;
  var QUIET_ZONE = 4;
  var ALIGNMENT_CENTERS = [6, 30];
  var GF_EXP = new Array(512);
  var GF_LOG = new Array(256);

  initializeGaloisField();

  function initializeGaloisField() {
    var value = 1;
    for (var index = 0; index < 255; index += 1) {
      GF_EXP[index] = value;
      GF_LOG[value] = index;
      value <<= 1;
      if (value & 0x100) value ^= 0x11d;
    }
    for (var offset = 255; offset < GF_EXP.length; offset += 1) {
      GF_EXP[offset] = GF_EXP[offset - 255];
    }
    GF_LOG[0] = 0;
  }

  function encodeUtf8(value) {
    var text = String(value == null ? "" : value);
    var bytes = [];

    for (var index = 0; index < text.length; index += 1) {
      var codePoint = text.charCodeAt(index);
      if (
        codePoint >= 0xd800 &&
        codePoint <= 0xdbff &&
        index + 1 < text.length
      ) {
        var low = text.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          codePoint =
            0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
          index += 1;
        }
      }

      if (codePoint < 0x80) {
        bytes.push(codePoint);
      } else if (codePoint < 0x800) {
        bytes.push(0xc0 | (codePoint >>> 6));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else if (codePoint < 0x10000) {
        bytes.push(0xe0 | (codePoint >>> 12));
        bytes.push(0x80 | ((codePoint >>> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else {
        bytes.push(0xf0 | (codePoint >>> 18));
        bytes.push(0x80 | ((codePoint >>> 12) & 0x3f));
        bytes.push(0x80 | ((codePoint >>> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      }
    }

    return bytes;
  }

  function BitBuffer() {
    this.bits = [];
  }

  BitBuffer.prototype.put = function (value, length) {
    for (var index = length - 1; index >= 0; index -= 1) {
      this.bits.push(((value >>> index) & 1) === 1);
    }
  };

  BitBuffer.prototype.toCodewords = function () {
    var output = [];
    for (var offset = 0; offset < this.bits.length; offset += 8) {
      var value = 0;
      for (var bit = 0; bit < 8; bit += 1) {
        if (this.bits[offset + bit]) value |= 1 << (7 - bit);
      }
      output.push(value);
    }
    return output;
  };

  function createDataCodewords(text) {
    var bytes = encodeUtf8(text);
    if (bytes.length > 106) {
      throw new Error("QR 內容過長，請縮短領取網址。");
    }

    var buffer = new BitBuffer();
    buffer.put(0x4, 4);
    buffer.put(bytes.length, 8);
    bytes.forEach(function (value) {
      buffer.put(value, 8);
    });

    var capacity = DATA_CODEWORDS * 8;
    buffer.put(0, Math.min(4, capacity - buffer.bits.length));
    while (buffer.bits.length % 8 !== 0) buffer.bits.push(false);

    var codewords = buffer.toCodewords();
    var pad = true;
    while (codewords.length < DATA_CODEWORDS) {
      codewords.push(pad ? 0xec : 0x11);
      pad = !pad;
    }
    return codewords;
  }

  function galoisMultiply(left, right) {
    if (left === 0 || right === 0) return 0;
    return GF_EXP[GF_LOG[left] + GF_LOG[right]];
  }

  function createGeneratorPolynomial(degree) {
    var polynomial = [1];
    for (var index = 0; index < degree; index += 1) {
      var next = new Array(polynomial.length + 1).fill(0);
      for (var coefficient = 0; coefficient < polynomial.length; coefficient += 1) {
        next[coefficient] ^= polynomial[coefficient];
        next[coefficient + 1] ^=
          galoisMultiply(polynomial[coefficient], GF_EXP[index]);
      }
      polynomial = next;
    }
    return polynomial;
  }

  function createErrorCodewords(data) {
    var generator = createGeneratorPolynomial(ERROR_CODEWORDS);
    var message = data.concat(new Array(ERROR_CODEWORDS).fill(0));

    for (var index = 0; index < data.length; index += 1) {
      var factor = message[index];
      if (factor === 0) continue;
      for (var offset = 0; offset < generator.length; offset += 1) {
        message[index + offset] ^=
          galoisMultiply(generator[offset], factor);
      }
    }

    return message.slice(data.length);
  }

  function createEmptyMatrix() {
    return Array.from({ length: SIZE }, function () {
      return new Array(SIZE).fill(null);
    });
  }

  function placeFinder(matrix, top, left) {
    for (var rowOffset = -1; rowOffset <= 7; rowOffset += 1) {
      var row = top + rowOffset;
      if (row < 0 || row >= SIZE) continue;
      for (var columnOffset = -1; columnOffset <= 7; columnOffset += 1) {
        var column = left + columnOffset;
        if (column < 0 || column >= SIZE) continue;
        var dark =
          (rowOffset >= 0 &&
            rowOffset <= 6 &&
            (columnOffset === 0 || columnOffset === 6)) ||
          (columnOffset >= 0 &&
            columnOffset <= 6 &&
            (rowOffset === 0 || rowOffset === 6)) ||
          (rowOffset >= 2 &&
            rowOffset <= 4 &&
            columnOffset >= 2 &&
            columnOffset <= 4);
        matrix[row][column] = dark;
      }
    }
  }

  function placeAlignmentPatterns(matrix) {
    ALIGNMENT_CENTERS.forEach(function (row) {
      ALIGNMENT_CENTERS.forEach(function (column) {
        if (matrix[row][column] !== null) return;
        for (var rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
          for (var columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
            matrix[row + rowOffset][column + columnOffset] =
              Math.max(Math.abs(rowOffset), Math.abs(columnOffset)) !== 1;
          }
        }
      });
    });
  }

  function placeTimingPatterns(matrix) {
    for (var index = 8; index < SIZE - 8; index += 1) {
      if (matrix[index][6] === null) matrix[index][6] = index % 2 === 0;
      if (matrix[6][index] === null) matrix[6][index] = index % 2 === 0;
    }
  }

  function bchDigit(value) {
    var digit = 0;
    while (value !== 0) {
      digit += 1;
      value >>>= 1;
    }
    return digit;
  }

  function formatBits(maskPattern) {
    var data = (1 << 3) | maskPattern;
    var remainder = data << 10;
    var generator = 0x537;
    while (bchDigit(remainder) - bchDigit(generator) >= 0) {
      remainder ^=
        generator << (bchDigit(remainder) - bchDigit(generator));
    }
    return ((data << 10) | remainder) ^ 0x5412;
  }

  function placeFormatInformation(matrix, maskPattern) {
    var bits = formatBits(maskPattern);
    var index;
    var dark;

    for (index = 0; index < 15; index += 1) {
      dark = ((bits >>> index) & 1) === 1;
      if (index < 6) {
        matrix[index][8] = dark;
      } else if (index < 8) {
        matrix[index + 1][8] = dark;
      } else {
        matrix[SIZE - 15 + index][8] = dark;
      }
    }

    for (index = 0; index < 15; index += 1) {
      dark = ((bits >>> index) & 1) === 1;
      if (index < 8) {
        matrix[8][SIZE - index - 1] = dark;
      } else if (index < 9) {
        matrix[8][15 - index] = dark;
      } else {
        matrix[8][15 - index - 1] = dark;
      }
    }

    matrix[SIZE - 8][8] = true;
  }

  function maskApplies(pattern, row, column) {
    var product = row * column;
    if (pattern === 0) return (row + column) % 2 === 0;
    if (pattern === 1) return row % 2 === 0;
    if (pattern === 2) return column % 3 === 0;
    if (pattern === 3) return (row + column) % 3 === 0;
    if (pattern === 4) {
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    }
    if (pattern === 5) return (product % 2) + (product % 3) === 0;
    if (pattern === 6) return ((product % 2) + (product % 3)) % 2 === 0;
    return ((row + column) % 2 + (product % 3)) % 2 === 0;
  }

  function placeData(matrix, codewords, maskPattern) {
    var row = SIZE - 1;
    var direction = -1;
    var byteIndex = 0;
    var bitIndex = 7;

    for (var right = SIZE - 1; right > 0; right -= 2) {
      if (right === 6) right -= 1;

      while (true) {
        for (var offset = 0; offset < 2; offset += 1) {
          var column = right - offset;
          if (matrix[row][column] !== null) continue;

          var dark =
            byteIndex < codewords.length &&
            ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
          if (maskApplies(maskPattern, row, column)) dark = !dark;
          matrix[row][column] = dark;

          bitIndex -= 1;
          if (bitIndex < 0) {
            byteIndex += 1;
            bitIndex = 7;
          }
        }

        row += direction;
        if (row < 0 || row >= SIZE) {
          row -= direction;
          direction = -direction;
          break;
        }
      }
    }
  }

  function createBaseMatrix(maskPattern) {
    var matrix = createEmptyMatrix();
    placeFinder(matrix, 0, 0);
    placeFinder(matrix, SIZE - 7, 0);
    placeFinder(matrix, 0, SIZE - 7);
    placeAlignmentPatterns(matrix);
    placeTimingPatterns(matrix);
    placeFormatInformation(matrix, maskPattern);
    return matrix;
  }

  function penaltyScore(matrix) {
    var score = 0;
    var row;
    var column;

    function scoreRuns(getValue) {
      var subtotal = 0;
      for (var outer = 0; outer < SIZE; outer += 1) {
        var runValue = getValue(outer, 0);
        var runLength = 1;
        for (var inner = 1; inner < SIZE; inner += 1) {
          var value = getValue(outer, inner);
          if (value === runValue) {
            runLength += 1;
          } else {
            if (runLength >= 5) subtotal += 3 + runLength - 5;
            runValue = value;
            runLength = 1;
          }
        }
        if (runLength >= 5) subtotal += 3 + runLength - 5;
      }
      return subtotal;
    }

    score += scoreRuns(function (outer, inner) {
      return matrix[outer][inner];
    });
    score += scoreRuns(function (outer, inner) {
      return matrix[inner][outer];
    });

    for (row = 0; row < SIZE - 1; row += 1) {
      for (column = 0; column < SIZE - 1; column += 1) {
        var value = matrix[row][column];
        if (
          matrix[row][column + 1] === value &&
          matrix[row + 1][column] === value &&
          matrix[row + 1][column + 1] === value
        ) {
          score += 3;
        }
      }
    }

    function scoreFinderLike(line) {
      var subtotal = 0;
      var bits = line.map(function (value) {
        return value ? "1" : "0";
      }).join("");
      for (var index = 0; index <= bits.length - 11; index += 1) {
        var pattern = bits.slice(index, index + 11);
        if (pattern === "00001011101" || pattern === "10111010000") {
          subtotal += 40;
        }
      }
      return subtotal;
    }

    for (row = 0; row < SIZE; row += 1) {
      score += scoreFinderLike(matrix[row]);
    }
    for (column = 0; column < SIZE; column += 1) {
      score += scoreFinderLike(
        matrix.map(function (matrixRow) {
          return matrixRow[column];
        })
      );
    }

    var darkModules = 0;
    matrix.forEach(function (matrixRow) {
      matrixRow.forEach(function (value) {
        if (value) darkModules += 1;
      });
    });
    var totalModules = SIZE * SIZE;
    score +=
      Math.floor(Math.abs(darkModules * 20 - totalModules * 10) / totalModules) *
      10;
    return score;
  }

  function createMatrix(text) {
    var data = createDataCodewords(text);
    var codewords = data.concat(createErrorCodewords(data));
    var bestMatrix = null;
    var bestScore = Infinity;

    for (var maskPattern = 0; maskPattern < 8; maskPattern += 1) {
      var matrix = createBaseMatrix(maskPattern);
      placeData(matrix, codewords, maskPattern);
      var score = penaltyScore(matrix);
      if (score < bestScore) {
        bestScore = score;
        bestMatrix = matrix;
      }
    }

    return bestMatrix;
  }

  function renderSvg(svg, text, options) {
    if (!svg || String(svg.namespaceURI || "") !== "http://www.w3.org/2000/svg") {
      throw new Error("QR 輸出元素必須是 SVG。");
    }

    options = options || {};
    var matrix = createMatrix(text);
    var viewSize = SIZE + QUIET_ZONE * 2;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + viewSize + " " + viewSize);
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      String(options.label || "點數領取 QR Code")
    );

    var namespace = "http://www.w3.org/2000/svg";
    var background = svg.ownerDocument.createElementNS(namespace, "rect");
    background.setAttribute("width", String(viewSize));
    background.setAttribute("height", String(viewSize));
    background.setAttribute("fill", String(options.background || "#ffffff"));
    svg.appendChild(background);

    var commands = [];
    matrix.forEach(function (matrixRow, row) {
      matrixRow.forEach(function (dark, column) {
        if (!dark) return;
        commands.push(
          "M" +
            (column + QUIET_ZONE) +
            " " +
            (row + QUIET_ZONE) +
            "h1v1h-1z"
        );
      });
    });
    var path = svg.ownerDocument.createElementNS(namespace, "path");
    path.setAttribute("d", commands.join(""));
    path.setAttribute("fill", String(options.foreground || "#10271d"));
    svg.appendChild(path);
    return matrix;
  }

  function toPngDataUrl(text, options) {
    options = options || {};
    if (!global.document || typeof global.document.createElement !== "function") {
      throw new Error("目前環境無法建立 QR 圖片。");
    }

    var matrix = createMatrix(text);
    var scale = Math.max(4, Math.min(24, Math.floor(Number(options.scale) || 12)));
    var viewSize = SIZE + QUIET_ZONE * 2;
    var canvas = global.document.createElement("canvas");
    canvas.width = viewSize * scale;
    canvas.height = viewSize * scale;
    var context = canvas.getContext("2d");
    if (!context) throw new Error("目前瀏覽器無法建立 QR 圖片。");

    context.imageSmoothingEnabled = false;
    context.fillStyle = String(options.background || "#ffffff");
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = String(options.foreground || "#10271d");
    matrix.forEach(function (matrixRow, row) {
      matrixRow.forEach(function (dark, column) {
        if (!dark) return;
        context.fillRect(
          (column + QUIET_ZONE) * scale,
          (row + QUIET_ZONE) * scale,
          scale,
          scale
        );
      });
    });
    return canvas.toDataURL("image/png");
  }

  global.PersonaQr = Object.freeze({
    createMatrix: createMatrix,
    renderSvg: renderSvg,
    toPngDataUrl: toPngDataUrl,
  });
})(typeof window !== "undefined" ? window : globalThis);
