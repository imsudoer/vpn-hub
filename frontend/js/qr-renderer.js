(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QrRenderer = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ECL = { L: 0, M: 1, Q: 2, H: 3 };

  var ECL_FORMAT_BITS = { 0: 1, 1: 0, 2: 3, 3: 2 }; 

  var ECC_CODEWORDS_PER_BLOCK = [

    [-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], 
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], 
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], 
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], 
  ];

  var NUM_ERROR_CORRECTION_BLOCKS = [

    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], 
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], 
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], 
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], 
  ];

  var PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function initGaloisTables() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x = x << 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsDivisor(degree) {
    var result = new Uint8Array(degree);
    result[degree - 1] = 1; 
    var root = 1;
    for (var i = 0; i < degree; i++) {

      for (var j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    var result = new Uint8Array(divisor.length);
    for (var di = 0; di < data.length; di++) {
      var factor = data[di] ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (var i = 0; i < divisor.length; i++) {
        result[i] ^= gfMul(divisor[i], factor);
      }
    }
    return result;
  }

  function BitBuffer() {
    this.bytes = [];
    this.bitLength = 0;
  }
  BitBuffer.prototype.appendBits = function (value, len) {
    if (len < 0 || len > 32 || (len < 32 && (value >>> len) !== 0)) {
      throw new RangeError('Value out of range');
    }
    for (var i = len - 1; i >= 0; i--) {
      this.bytes.push((value >>> i) & 1);
      this.bitLength++;
    }
  };

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);

    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c < 0xd800 || c >= 0xe000) {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {

        i++;
        var c2 = str.charCodeAt(i);
        var cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      }
    }
    return new Uint8Array(out);
  }

  function getNumRawDataModules(ver) {
    if (ver < 1 || ver > 40) throw new RangeError('Version out of range');
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function getNumDataCodewords(ver, ecl) {
    return (
      Math.floor(getNumRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver]
    );
  }

  function charCountBits(ver) {

    return ver <= 9 ? 8 : 16;
  }

  function chooseVersion(byteLen, ecl) {
    for (var ver = 1; ver <= 40; ver++) {
      var capacityBits = getNumDataCodewords(ver, ecl) * 8;
      var needed = 4 + charCountBits(ver) + byteLen * 8;
      if (needed <= capacityBits) return ver;
    }
    return -1;
  }

  function encodeDataCodewords(bytes, ver, ecl) {
    var bb = new BitBuffer();
    bb.appendBits(0x4, 4); 
    bb.appendBits(bytes.length, charCountBits(ver));
    for (var i = 0; i < bytes.length; i++) bb.appendBits(bytes[i], 8);

    var capacityBits = getNumDataCodewords(ver, ecl) * 8;
    if (bb.bitLength > capacityBits) throw new RangeError('Data too long for chosen version/ECC');

    bb.appendBits(0, Math.min(4, capacityBits - bb.bitLength));
    bb.appendBits(0, (8 - (bb.bitLength % 8)) % 8);

    for (var pad = 0xec; bb.bitLength < capacityBits; pad ^= 0xec ^ 0x11) {
      bb.appendBits(pad, 8);
    }

    var data = new Uint8Array(bb.bitLength / 8);
    bb.bytes.forEach(function (bit, idx) {
      data[idx >>> 3] |= bit << (7 - (idx & 7));
    });
    return addEccAndInterleave(data, ver, ecl);
  }

  function addEccAndInterleave(data, ver, ecl) {
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var rsDiv = rsDivisor(blockEccLen);
    var blocks = [];
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = Array.prototype.slice.call(data.subarray(k, k + datLen));
      k += datLen;
      var ecc = Array.prototype.slice.call(rsRemainder(dat, rsDiv));
      if (i < numShortBlocks) dat.push(0); 
      blocks.push(dat.concat(ecc));
    }

    var result = [];
    for (var ci = 0; ci < blocks[0].length; ci++) {
      for (var bi = 0; bi < blocks.length; bi++) {

        if (ci !== shortBlockLen - blockEccLen || bi >= numShortBlocks) {
          result.push(blocks[bi][ci]);
        }
      }
    }
    return result;
  }

  function QrMatrix(ver) {
    this.version = ver;
    this.size = ver * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (var y = 0; y < this.size; y++) {
      var rowM = new Array(this.size).fill(false);
      var rowF = new Array(this.size).fill(false);
      this.modules.push(rowM);
      this.isFunction.push(rowF);
    }
  }

  QrMatrix.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
  }

  QrMatrix.prototype.getAlignmentPatternPositions = function () {
    if (this.version === 1) return [];
    var numAlign = Math.floor(this.version / 7) + 2;
    var step = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = this.size - 7; result.length < numAlign; pos -= step) {
      result.splice(1, 0, pos);
    }
    return result;
  };

  QrMatrix.prototype.drawFunctionPatterns = function () {
    var i, j;

    for (i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    var alignPos = this.getAlignmentPatternPositions();
    var numAlign = alignPos.length;
    for (i = 0; i < numAlign; i++) {
      for (j = 0; j < numAlign; j++) {
        var skipCorner =
          (i === 0 && j === 0) ||
          (i === 0 && j === numAlign - 1) ||
          (i === numAlign - 1 && j === 0);
        if (!skipCorner) this.drawAlignmentPattern(alignPos[i], alignPos[j]);
      }
    }

    this.drawFormatBits(0);
    this.drawVersion();
  };

  QrMatrix.prototype.drawFinderPattern = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  QrMatrix.prototype.drawAlignmentPattern = function (x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  QrMatrix.prototype.drawFormatBits = function (mask) {

    var data = (ECL_FORMAT_BITS[this.ecl] << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;

    for (var a = 0; a <= 5; a++) this.setFunctionModule(8, a, getBit(bits, a));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (var b = 9; b < 15; b++) this.setFunctionModule(14 - b, 8, getBit(bits, b));

    for (var c = 0; c < 8; c++) this.setFunctionModule(this.size - 1 - c, 8, getBit(bits, c));
    for (var d = 8; d < 15; d++) this.setFunctionModule(8, this.size - 15 + d, getBit(bits, d));
    this.setFunctionModule(8, this.size - 8, true); 
  };

  QrMatrix.prototype.drawVersion = function () {
    if (this.version < 7) return;

    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var bits = (this.version << 12) | rem;
    for (var j = 0; j < 18; j++) {
      var bit = getBit(bits, j);
      var a = this.size - 11 + (j % 3);
      var b = Math.floor(j / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  };

  QrMatrix.prototype.drawCodewords = function (data) {
    var i = 0; 

    for (var right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < this.size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  var MASK_FUNCTIONS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0; },
    function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; },
    function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; },
  ];

  QrMatrix.prototype.applyMask = function (mask) {
    var masker = MASK_FUNCTIONS[mask];
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && masker(x, y)) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  };

  QrMatrix.prototype.finderPenaltyCountPatterns = function (runHistory) {
    var n = runHistory[1];
    var core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
    return (
      (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
      (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
    );
  };

  QrMatrix.prototype.finderPenaltyAddHistory = function (currentRunLength, runHistory) {
    if (runHistory[0] === 0) currentRunLength += this.size; 
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  };

  QrMatrix.prototype.getPenaltyScore = function () {
    var result = 0;
    var size = this.size;
    var x, y;

    for (y = 0; y < size; y++) {
      var runColor = false, runX = 0;
      var runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (x = 0; x < size; x++) {
        if (this.modules[y][x] === runColor) {
          runX++;
          if (runX === 5) result += PENALTY_N1;
          else if (runX > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runX, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runX = 1;
        }
      }
      result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
    }

    for (x = 0; x < size; x++) {
      var runColorC = false, runY = 0;
      var runHistoryC = [0, 0, 0, 0, 0, 0, 0];
      for (y = 0; y < size; y++) {
        if (this.modules[y][x] === runColorC) {
          runY++;
          if (runY === 5) result += PENALTY_N1;
          else if (runY > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runY, runHistoryC);
          if (!runColorC) result += this.finderPenaltyCountPatterns(runHistoryC) * PENALTY_N3;
          runColorC = this.modules[y][x];
          runY = 1;
        }
      }
      result += this.finderPenaltyCountPatterns(runHistoryC) * PENALTY_N3;
    }

    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var color = this.modules[y][x];
        if (
          color === this.modules[y][x + 1] &&
          color === this.modules[y + 1][x] &&
          color === this.modules[y + 1][x + 1]
        ) {
          result += PENALTY_N2;
        }
      }
    }

    var dark = 0;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) if (this.modules[y][x]) dark++;
    }
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  };

  function encode(text, options) {
    var opts = options || {};
    var ecl = ECL[String(opts.ecl || 'M').toUpperCase()];
    if (ecl === undefined) throw new RangeError('Unknown ECC level: ' + opts.ecl);

    var bytes = utf8Bytes(String(text));
    var ver;
    if (opts.version) {
      ver = opts.version;
      if (ver < 1 || ver > 40) throw new RangeError('Version out of range');
      if (4 + charCountBits(ver) + bytes.length * 8 > getNumDataCodewords(ver, ecl) * 8) {
        throw new RangeError('Data too long for version ' + ver + ' at ECC ' + opts.ecl);
      }
    } else {
      ver = chooseVersion(bytes.length, ecl);
      if (ver < 0) throw new RangeError('Data too long for a QR Code at ECC level ' + (opts.ecl || 'M'));
    }

    var allCodewords = encodeDataCodewords(bytes, ver, ecl);

    var qr = new QrMatrix(ver);
    qr.ecl = ecl;
    qr.drawFunctionPatterns();
    qr.drawCodewords(allCodewords);

    var bestMask = -1;
    var minPenalty = Infinity;
    var masksToTry = opts.mask !== undefined && opts.mask !== null ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
    for (var mi = 0; mi < masksToTry.length; mi++) {
      var mask = masksToTry[mi];
      qr.applyMask(mask);
      qr.drawFormatBits(mask);
      var penalty = qr.getPenaltyScore();
      if (penalty < minPenalty) {
        minPenalty = penalty;
        bestMask = mask;
      }
      qr.applyMask(mask); 
    }
    qr.applyMask(bestMask);
    qr.drawFormatBits(bestMask);
    qr.mask = bestMask;
    return qr;
  }

  function toMatrix(text, options) {
    var qr = encode(text, options);
    return {
      version: qr.version,
      mask: qr.mask,
      ecl: (options && options.ecl) || 'M',
      size: qr.size,
      modules: qr.modules.map(function (row) { return row.slice(); }),
    };
  }

  function toSvg(text, options) {
    var opts = options || {};
    var border = opts.border !== undefined ? Math.max(0, opts.border | 0) : 4;
    var scale = opts.scale > 0 ? opts.scale : 6;
    var dark = opts.dark || '#1a1c1e';
    var light = opts.light || '#f7f8fa';

    var qr = encode(text, opts);
    lastRender = { version: qr.version, mask: qr.mask, size: qr.size };
    var size = qr.size;
    var dim = size + border * 2;

    var parts = [];
    for (var y = 0; y < size; y++) {
      var x = 0;
      while (x < size) {
        if (qr.modules[y][x]) {
          var start = x;
          while (x < size && qr.modules[y][x]) x++;
          var w = x - start;
          parts.push('M' + (start + border) + ' ' + (y + border) + 'h' + w + 'v1h-' + w + 'z');
        } else {
          x++;
        }
      }
    }

    var px = dim * scale;
    var titleEl = opts.title ? '<title>' + escapeXml(String(opts.title)) + '</title>' : '';
    var roleAttr = opts.title ? ' role="img" aria-label="' + escapeXml(String(opts.title)) + '"' : ' aria-hidden="true"';

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '"' +
      ' width="' + px + '" height="' + px + '"' + roleAttr + ' shape-rendering="crispEdges">' +
      titleEl +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + escapeXml(light) + '"/>' +
      '<path d="' + parts.join('') + '" fill="' + escapeXml(dark) + '"/>' +
      '</svg>'
    );
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var lastRender = null;

  return {
    toSvg: toSvg,
    toMatrix: toMatrix,
    ECL: ECL,
    _getLastRender: function () { return lastRender; },
    _internals: {
      getNumRawDataModules: getNumRawDataModules,
      getNumDataCodewords: getNumDataCodewords,
      chooseVersion: chooseVersion,
      ECC_CODEWORDS_PER_BLOCK: ECC_CODEWORDS_PER_BLOCK,
      NUM_ERROR_CORRECTION_BLOCKS: NUM_ERROR_CORRECTION_BLOCKS,
      encodeDataCodewords: encodeDataCodewords,
    },
  };
});
