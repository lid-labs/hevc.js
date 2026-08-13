"use strict";
var HevcHls = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
  var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

  // demo/hls-entry.ts
  var hls_entry_exports = {};
  __export(hls_entry_exports, {
    attachHevcSupport: () => attachHevcSupport,
    subscribeSegmentStat: () => subscribeSegmentStat
  });

  // node_modules/.pnpm/mp4box@2.4.1/node_modules/mp4box/dist/rolldown-runtime-w6R9maHv.mjs
  var __defProp2 = Object.defineProperty;
  var __exportAll = (all, no_symbols) => {
    let target = {};
    for (var name in all) {
      __defProp2(target, name, {
        get: all[name],
        enumerable: true
      });
    }
    if (!no_symbols) {
      __defProp2(target, Symbol.toStringTag, { value: "Module" });
    }
    return target;
  };

  // node_modules/.pnpm/mp4box@2.4.1/node_modules/mp4box/dist/styp-9TIZZDLN.mjs
  var MAX_SIZE = Math.pow(2, 32);
  var MAX_UINT32 = Math.pow(2, 32) - 1;
  var TFHD_FLAG_DEFAULT_BASE_IS_MOOF = 131072;
  var TRUN_FLAGS_FLAGS = 1024;
  var TRUN_FLAGS_CTS_OFFSET = 2048;
  var MP4BoxBuffer = class MP4BoxBuffer2 extends ArrayBuffer {
    constructor(byteLength) {
      super(byteLength);
      this.fileStart = 0;
      this.usedBytes = 0;
    }
    static fromArrayBuffer(buffer, fileStart) {
      const mp4BoxBuffer = new MP4BoxBuffer2(buffer.byteLength);
      new Uint8Array(mp4BoxBuffer).set(new Uint8Array(buffer));
      mp4BoxBuffer.fileStart = fileStart;
      return mp4BoxBuffer;
    }
  };
  var _DataStream_instances, isTupleType_fn, _a;
  var DataStream = (_a = class {
    /**
    * DataStream reads scalars, arrays and structs of data from an ArrayBuffer.
    * It's like a file-like DataView on steroids.
    *
    * @param arrayBuffer ArrayBuffer to read from.
    * @param byteOffset Offset from arrayBuffer beginning for the DataStream.
    * @param endianness Endianness of the DataStream (default: BIG_ENDIAN).
    */
    constructor(arrayBuffer, byteOffset, endianness) {
      __privateAdd(this, _DataStream_instances);
      this._byteLength = 0;
      this.failurePosition = 0;
      this._dynamicSize = 1;
      this._byteOffset = byteOffset || 0;
      if (arrayBuffer instanceof ArrayBuffer) this.buffer = MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0);
      else if (arrayBuffer instanceof DataView) {
        this.dataView = arrayBuffer;
        if (byteOffset) this._byteOffset += byteOffset;
      } else this.buffer = new MP4BoxBuffer(arrayBuffer || 0);
      this.position = 0;
      this.endianness = endianness ? endianness : 1;
    }
    getPosition() {
      return this.position;
    }
    /**
    * Internal function to resize the DataStream buffer when required.
    * @param extra Number of bytes to add to the buffer allocation.
    */
    _realloc(extra) {
      if (!this._dynamicSize) return;
      const req = this._byteOffset + this.position + extra;
      let blen = this._buffer.byteLength;
      if (req <= blen) {
        if (req > this._byteLength) this._byteLength = req;
        return;
      }
      if (blen < 1) blen = 1;
      while (req > blen) blen *= 2;
      const buf = new MP4BoxBuffer(blen);
      const src = new Uint8Array(this._buffer);
      new Uint8Array(buf, 0, src.length).set(src);
      this.buffer = buf;
      this._byteLength = req;
    }
    /**
    * Internal function to trim the DataStream buffer when required.
    * Used for stripping out the extra bytes from the backing buffer when
    * the virtual byteLength is smaller than the buffer byteLength (happens after
    * growing the buffer with writes and not filling the extra space completely).
    */
    _trimAlloc() {
      if (this._byteLength === this._buffer.byteLength) return;
      const buf = new MP4BoxBuffer(this._byteLength);
      const dst = new Uint8Array(buf);
      const src = new Uint8Array(this._buffer, 0, dst.length);
      dst.set(src);
      this.buffer = buf;
    }
    /**
    * Returns the byte length of the DataStream object.
    * @type {number}
    */
    get byteLength() {
      return this._byteLength - this._byteOffset;
    }
    /**
    * Set/get the backing ArrayBuffer of the DataStream object.
    * The setter updates the DataView to point to the new buffer.
    * @type {Object}
    */
    get buffer() {
      this._trimAlloc();
      return this._buffer;
    }
    set buffer(value) {
      this._buffer = value;
      this._dataView = new DataView(value, this._byteOffset);
      this._byteLength = value.byteLength;
    }
    /**
    * Set/get the byteOffset of the DataStream object.
    * The setter updates the DataView to point to the new byteOffset.
    * @type {number}
    */
    get byteOffset() {
      return this._byteOffset;
    }
    set byteOffset(value) {
      this._byteOffset = value;
      this._dataView = new DataView(this._buffer, this._byteOffset);
      this._byteLength = this._buffer.byteLength;
    }
    /**
    * Set/get the byteOffset of the DataStream object.
    * The setter updates the DataView to point to the new byteOffset.
    * @type {number}
    */
    get dataView() {
      return this._dataView;
    }
    set dataView(value) {
      this._byteOffset = value.byteOffset;
      this._buffer = MP4BoxBuffer.fromArrayBuffer(value.buffer, 0);
      this._dataView = new DataView(this._buffer, this._byteOffset);
      this._byteLength = this._byteOffset + value.byteLength;
    }
    /**
    *   Sets the DataStream read/write position to given position.
    *   Clamps between 0 and DataStream length.
    *
    *   @param pos Position to seek to.
    *   @return
    */
    seek(pos) {
      const npos = Math.max(0, Math.min(this.byteLength, pos));
      this.position = isNaN(npos) || !isFinite(npos) ? 0 : npos;
    }
    /**
    * Returns true if the DataStream seek pointer is at the end of buffer and
    * there's no more data to read.
    *
    * @return True if the seek pointer is at the end of the buffer.
    */
    isEof() {
      return this.position >= this._byteLength;
    }
    /**
    * Maps a Uint8Array into the DataStream buffer.
    *
    * Nice for quickly reading in data.
    *
    * @param length Number of elements to map.
    * @param e Endianness of the data to read.
    * @return Uint8Array to the DataStream backing buffer.
    */
    mapUint8Array(length) {
      this._realloc(length * 1);
      const arr = new Uint8Array(this._buffer, this.byteOffset + this.position, length);
      this.position += length * 1;
      return arr;
    }
    /**
    * Reads an Int32Array of desired length and endianness from the DataStream.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return The read Int32Array.
    */
    readInt32Array(length, endianness) {
      length = length === void 0 ? this.byteLength - this.position / 4 : length;
      const arr = new Int32Array(length);
      _a.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += arr.byteLength;
      return arr;
    }
    /**
    * Reads an Int16Array of desired length and endianness from the DataStream.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return The read Int16Array.
    */
    readInt16Array(length, endianness) {
      length = length === void 0 ? this.byteLength - this.position / 2 : length;
      const arr = new Int16Array(length);
      _a.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += arr.byteLength;
      return arr;
    }
    /**
    * Reads an Int8Array of desired length from the DataStream.
    *
    * @param length Number of elements to map.
    * @param e Endianness of the data to read.
    * @return The read Int8Array.
    */
    readInt8Array(length) {
      length = length === void 0 ? this.byteLength - this.position : length;
      const arr = new Int8Array(length);
      _a.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
      this.position += arr.byteLength;
      return arr;
    }
    /**
    * Reads a Uint32Array of desired length and endianness from the DataStream.
    *
    *  @param length Number of elements to map.
    *  @param endianness Endianness of the data to read.
    *  @return The read Uint32Array.
    */
    readUint32Array(length, endianness) {
      length = length === void 0 ? this.byteLength - this.position / 4 : length;
      const arr = new Uint32Array(length);
      _a.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += arr.byteLength;
      return arr;
    }
    /**
    * Reads a Uint16Array of desired length and endianness from the DataStream.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return The read Uint16Array.
    */
    readUint16Array(length, endianness) {
      length = length === void 0 ? this.byteLength - this.position / 2 : length;
      const arr = new Uint16Array(length);
      _a.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += arr.byteLength;
      return arr;
    }
    /**
    * Reads a Uint8Array of desired length from the DataStream.
    *
    * @param length Number of elements to map.
    * @param e Endianness of the data to read.
    * @return The read Uint8Array.
    */
    readUint8Array(length) {
      length = length === void 0 ? this.byteLength - this.position : length;
      const arr = new Uint8Array(length);
      _a.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
      this.position += arr.byteLength;
      return arr;
    }
    /**
    * Reads a Float64Array of desired length and endianness from the DataStream.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return The read Float64Array.
    */
    readFloat64Array(length, endianness) {
      length = length === void 0 ? this.byteLength - this.position / 8 : length;
      const arr = new Float64Array(length);
      _a.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += arr.byteLength;
      return arr;
    }
    /**
    * Reads a Float32Array of desired length and endianness from the DataStream.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return The read Float32Array.
    */
    readFloat32Array(length, endianness) {
      length = length === void 0 ? this.byteLength - this.position / 4 : length;
      const arr = new Float32Array(length);
      _a.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += arr.byteLength;
      return arr;
    }
    /**
    * Reads a 32-bit int from the DataStream with the desired endianness.
    *
    * @param endianness Endianness of the number.
    * @return The read number.
    */
    readInt32(endianness) {
      const v = this._dataView.getInt32(this.position, (endianness ?? this.endianness) === 2);
      this.position += 4;
      return v;
    }
    /**
    * Reads a 16-bit int from the DataStream with the desired endianness.
    *
    * @param endianness Endianness of the number.
    * @return The read number.
    */
    readInt16(endianness) {
      const v = this._dataView.getInt16(this.position, (endianness ?? this.endianness) === 2);
      this.position += 2;
      return v;
    }
    /**
    * Reads an 8-bit int from the DataStream.
    *
    * @return The read number.
    */
    readInt8() {
      const v = this._dataView.getInt8(this.position);
      this.position += 1;
      return v;
    }
    /**
    * Reads a 32-bit unsigned int from the DataStream with the desired endianness.
    *
    * @param endianness Endianness of the number.
    * @return The read number.
    */
    readUint32(endianness) {
      const v = this._dataView.getUint32(this.position, (endianness ?? this.endianness) === 2);
      this.position += 4;
      return v;
    }
    /**
    * Reads a 16-bit unsigned int from the DataStream with the desired endianness.
    *
    * @param endianness Endianness of the number.
    * @return The read number.
    */
    readUint16(endianness) {
      const v = this._dataView.getUint16(this.position, (endianness ?? this.endianness) === 2);
      this.position += 2;
      return v;
    }
    /**
    * Reads an 8-bit unsigned int from the DataStream.
    *
    * @return The read number.
    */
    readUint8() {
      const v = this._dataView.getUint8(this.position);
      this.position += 1;
      return v;
    }
    /**
    * Reads a 32-bit float from the DataStream with the desired endianness.
    *
    * @param endianness Endianness of the number.
    * @return The read number.
    */
    readFloat32(endianness) {
      const value = this._dataView.getFloat32(this.position, (endianness ?? this.endianness) === 2);
      this.position += 4;
      return value;
    }
    /**
    * Reads a 64-bit float from the DataStream with the desired endianness.
    *
    * @param endianness Endianness of the number.
    * @return The read number.
    */
    readFloat64(endianness) {
      const value = this._dataView.getFloat64(this.position, (endianness ?? this.endianness) === 2);
      this.position += 8;
      return value;
    }
    /**
    * Copies byteLength bytes from the src buffer at srcOffset to the
    * dst buffer at dstOffset.
    *
    * @param dst Destination ArrayBuffer to write to.
    * @param dstOffset Offset to the destination ArrayBuffer.
    * @param src Source ArrayBuffer to read from.
    * @param srcOffset Offset to the source ArrayBuffer.
    * @param byteLength Number of bytes to copy.
    */
    static memcpy(dst, dstOffset, src, srcOffset, byteLength) {
      const dstU8 = new Uint8Array(dst, dstOffset, byteLength);
      const srcU8 = new Uint8Array(src, srcOffset, byteLength);
      dstU8.set(srcU8);
    }
    /**
    * Converts array to native endianness in-place.
    *
    * @param typedArray Typed array to convert.
    * @param endianness True if the data in the array is
    *                                      little-endian. Set false for big-endian.
    * @return The converted typed array.
    */
    static arrayToNative(typedArray, endianness) {
      if (endianness === _a.ENDIANNESS) return typedArray;
      else return this.flipArrayEndianness(typedArray);
    }
    /**
    * Converts native endianness array to desired endianness in-place.
    *
    * @param typedArray Typed array to convert.
    * @param littleEndian True if the converted array should be
    *                               little-endian. Set false for big-endian.
    * @return The converted typed array.
    */
    static nativeToEndian(typedArray, littleEndian) {
      if (littleEndian && _a.ENDIANNESS === 2) return typedArray;
      else return this.flipArrayEndianness(typedArray);
    }
    /**
    * Flips typed array endianness in-place.
    *
    * @param typedArray Typed array to flip.
    * @return The converted typed array.
    */
    static flipArrayEndianness(typedArray) {
      const u8 = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
      for (let i = 0; i < typedArray.byteLength; i += typedArray.BYTES_PER_ELEMENT) for (let j = i + typedArray.BYTES_PER_ELEMENT - 1, k = i; j > k; j--, k++) {
        const tmp = u8[k];
        u8[k] = u8[j];
        u8[j] = tmp;
      }
      return typedArray;
    }
    /**
    * Read a string of desired length and encoding from the DataStream.
    *
    * @param length The length of the string to read in bytes.
    * @param encoding The encoding of the string data in the DataStream.
    *                           Defaults to ASCII.
    * @return The read string.
    */
    readString(length, encoding) {
      if (encoding === void 0 || encoding === "ASCII") return fromCharCodeUint8(this.mapUint8Array(length === void 0 ? this.byteLength - this.position : length));
      else return new TextDecoder(encoding).decode(this.mapUint8Array(length));
    }
    /**
    * Read null-terminated string of desired length from the DataStream. Truncates
    * the returned string so that the null byte is not a part of it.
    *
    * @param length The length of the string to read.
    * @return The read string.
    */
    readCString(length) {
      let i = 0;
      const blen = this.byteLength - this.position;
      const u8 = new Uint8Array(this._buffer, this._byteOffset + this.position);
      const len = length !== void 0 ? Math.min(length, blen) : blen;
      for (; i < len && u8[i] !== 0; i++) ;
      const s = fromCharCodeUint8(this.mapUint8Array(i));
      if (length !== void 0) this.position += len - i;
      else if (i !== blen) this.position += 1;
      return s;
    }
    readInt64() {
      return this.readInt32() * MAX_SIZE + this.readUint32();
    }
    readUint64() {
      return this.readUint32() * MAX_SIZE + this.readUint32();
    }
    readUint24() {
      return (this.readUint8() << 16) + (this.readUint8() << 8) + this.readUint8();
    }
    /**
    * Saves the DataStream contents to the given filename.
    * Uses Chrome's anchor download property to initiate download.
    *
    * @param filename Filename to save as.
    * @return
    * @bundle DataStream-write.js
    */
    save(filename) {
      const blob = new Blob([this.buffer]);
      if (typeof window !== "undefined" && typeof document !== "undefined") if (window.URL && URL.createObjectURL) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.setAttribute("href", url);
        a.setAttribute("download", filename);
        a.setAttribute("target", "_self");
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else throw new Error("DataStream.save: Can't create object URL.");
      return blob;
    }
    /** @bundle DataStream-write.js */
    get dynamicSize() {
      return this._dynamicSize;
    }
    /** @bundle DataStream-write.js */
    set dynamicSize(v) {
      if (!v) this._trimAlloc();
      this._dynamicSize = v;
    }
    /**
    * Internal function to trim the DataStream buffer when required.
    * Used for stripping out the first bytes when not needed anymore.
    *
    * @return
    * @bundle DataStream-write.js
    */
    shift(offset) {
      const buf = new MP4BoxBuffer(this._byteLength - offset);
      const dst = new Uint8Array(buf);
      const src = new Uint8Array(this._buffer, offset, dst.length);
      dst.set(src);
      this.buffer = buf;
      this.position -= offset;
    }
    /**
    * Writes an Int32Array of specified endianness to the DataStream.
    *
    * @param array The array to write.
    * @param endianness Endianness of the data to write.
    * @bundle DataStream-write.js
    */
    writeInt32Array(array, endianness) {
      this._realloc(array.length * 4);
      if (array instanceof Int32Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
        _a.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
        this.mapInt32Array(array.length, endianness);
      } else for (let i = 0; i < array.length; i++) this.writeInt32(array[i], endianness);
    }
    /**
    * Writes an Int16Array of specified endianness to the DataStream.
    *
    * @param array The array to write.
    * @param endianness Endianness of the data to write.
    * @bundle DataStream-write.js
    */
    writeInt16Array(array, endianness) {
      this._realloc(array.length * 2);
      if (array instanceof Int16Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
        _a.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
        this.mapInt16Array(array.length, endianness);
      } else for (let i = 0; i < array.length; i++) this.writeInt16(array[i], endianness);
    }
    /**
    * Writes an Int8Array to the DataStream.
    *
    * @param array The array to write.
    * @bundle DataStream-write.js
    */
    writeInt8Array(array) {
      this._realloc(array.length * 1);
      if (array instanceof Int8Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
        _a.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
        this.mapInt8Array(array.length);
      } else for (let i = 0; i < array.length; i++) this.writeInt8(array[i]);
    }
    /**
    * Writes a Uint32Array of specified endianness to the DataStream.
    *
    * @param array The array to write.
    * @param endianness Endianness of the data to write.
    * @bundle DataStream-write.js
    */
    writeUint32Array(array, endianness) {
      this._realloc(array.length * 4);
      if (array instanceof Uint32Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
        _a.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
        this.mapUint32Array(array.length, endianness);
      } else for (let i = 0; i < array.length; i++) this.writeUint32(array[i], endianness);
    }
    /**
    * Writes a Uint16Array of specified endianness to the DataStream.
    *
    * @param array The array to write.
    * @param endianness Endianness of the data to write.
    * @bundle DataStream-write.js
    */
    writeUint16Array(array, endianness) {
      this._realloc(array.length * 2);
      if (array instanceof Uint16Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
        _a.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
        this.mapUint16Array(array.length, endianness);
      } else for (let i = 0; i < array.length; i++) this.writeUint16(array[i], endianness);
    }
    /**
    * Writes a Uint8Array to the DataStream.
    *
    * @param array The array to write.
    * @bundle DataStream-write.js
    */
    writeUint8Array(array) {
      this._realloc(array.length * 1);
      if (array instanceof Uint8Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
        _a.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
        this.mapUint8Array(array.length);
      } else for (let i = 0; i < array.length; i++) this.writeUint8(array[i]);
    }
    /**
    * Writes a Float64Array of specified endianness to the DataStream.
    *
    * @param array The array to write.
    * @param endianness Endianness of the data to write.
    * @bundle DataStream-write.js
    */
    writeFloat64Array(array, endianness) {
      this._realloc(array.length * 8);
      if (array instanceof Float64Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
        _a.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
        this.mapFloat64Array(array.length, endianness);
      } else for (let i = 0; i < array.length; i++) this.writeFloat64(array[i], endianness);
    }
    /**
    * Writes a Float32Array of specified endianness to the DataStream.
    *
    * @param array The array to write.
    * @param endianness Endianness of the data to write.
    * @bundle DataStream-write.js
    */
    writeFloat32Array(array, endianness) {
      this._realloc(array.length * 4);
      if (array instanceof Float32Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
        _a.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
        this.mapFloat32Array(array.length, endianness);
      } else for (let i = 0; i < array.length; i++) this.writeFloat32(array[i], endianness);
    }
    /**
    * Writes a 64-bit int to the DataStream with the desired endianness.
    *
    * @param value Number to write.
    * @param endianness Endianness of the number.
    * @bundle DataStream-write.js
    */
    writeInt64(value, endianness) {
      this._realloc(8);
      this._dataView.setBigInt64(this.position, BigInt(value), (endianness ?? this.endianness) === 2);
      this.position += 8;
    }
    /**
    * Writes a 32-bit int to the DataStream with the desired endianness.
    *
    * @param value Number to write.
    * @param endianness Endianness of the number.
    * @bundle DataStream-write.js
    */
    writeInt32(value, endianness) {
      this._realloc(4);
      this._dataView.setInt32(this.position, value, (endianness ?? this.endianness) === 2);
      this.position += 4;
    }
    /**
    * Writes a 16-bit int to the DataStream with the desired endianness.
    *
    * @param value Number to write.
    * @param endianness Endianness of the number.
    * @bundle DataStream-write.js
    */
    writeInt16(value, endianness) {
      this._realloc(2);
      this._dataView.setInt16(this.position, value, (endianness ?? this.endianness) === 2);
      this.position += 2;
    }
    /**
    * Writes an 8-bit int to the DataStream.
    *
    * @param value Number to write.
    * @bundle DataStream-write.js
    */
    writeInt8(value) {
      this._realloc(1);
      this._dataView.setInt8(this.position, value);
      this.position += 1;
    }
    /**
    * Writes a 32-bit unsigned int to the DataStream with the desired endianness.
    *
    * @param value Number to write.
    * @param endianness Endianness of the number.
    * @bundle DataStream-write.js
    */
    writeUint32(value, endianness) {
      this._realloc(4);
      this._dataView.setUint32(this.position, value, (endianness ?? this.endianness) === 2);
      this.position += 4;
    }
    /**
    * Writes a 16-bit unsigned int to the DataStream with the desired endianness.
    *
    * @param value Number to write.
    * @param endianness Endianness of the number.
    * @bundle DataStream-write.js
    */
    writeUint16(value, endianness) {
      this._realloc(2);
      this._dataView.setUint16(this.position, value, (endianness ?? this.endianness) === 2);
      this.position += 2;
    }
    /**
    * Writes an 8-bit unsigned  int to the DataStream.
    *
    * @param value Number to write.
    * @bundle DataStream-write.js
    */
    writeUint8(value) {
      this._realloc(1);
      this._dataView.setUint8(this.position, value);
      this.position += 1;
    }
    /**
    * Writes a 32-bit float to the DataStream with the desired endianness.
    *
    * @param value Number to write.
    * @param endianness Endianness of the number.
    * @bundle DataStream-write.js
    */
    writeFloat32(value, endianness) {
      this._realloc(4);
      this._dataView.setFloat32(this.position, value, (endianness ?? this.endianness) === 2);
      this.position += 4;
    }
    /**
    * Writes a 64-bit float to the DataStream with the desired endianness.
    *
    * @param value Number to write.
    * @param endianness Endianness of the number.
    * @bundle DataStream-write.js
    */
    writeFloat64(value, endianness) {
      this._realloc(8);
      this._dataView.setFloat64(this.position, value, (endianness ?? this.endianness) === 2);
      this.position += 8;
    }
    /**
    * Write a UCS-2 string of desired endianness to the DataStream. The
    * lengthOverride argument lets you define the number of characters to write.
    * If the string is shorter than lengthOverride, the extra space is padded with
    * zeroes.
    *
    * @param value The string to write.
    * @param endianness The endianness to use for the written string data.
    * @param lengthOverride The number of characters to write.
    * @bundle DataStream-write.js
    */
    writeUCS2String(value, endianness, lengthOverride) {
      if (lengthOverride === void 0) lengthOverride = value.length;
      let i;
      for (i = 0; i < value.length && i < lengthOverride; i++) this.writeUint16(value.charCodeAt(i), endianness);
      for (; i < lengthOverride; i++) this.writeUint16(0);
    }
    /**
    * Writes a string of desired length and encoding to the DataStream.
    *
    * @param value The string to write.
    * @param encoding The encoding for the written string data.
    *                           Defaults to ASCII.
    * @param length The number of characters to write.
    * @bundle DataStream-write.js
    */
    writeString(value, encoding, length) {
      let i = 0;
      if (encoding === void 0 || encoding === "ASCII") if (length !== void 0) {
        const len = Math.min(value.length, length);
        for (i = 0; i < len; i++) this.writeUint8(value.charCodeAt(i));
        for (; i < length; i++) this.writeUint8(0);
      } else for (i = 0; i < value.length; i++) this.writeUint8(value.charCodeAt(i));
      else this.writeUint8Array(new TextEncoder(encoding).encode(value.substring(0, length)));
    }
    /**
    * Writes a null-terminated string to DataStream and zero-pads it to length
    * bytes. If length is not given, writes the string followed by a zero.
    * If string is longer than length, the written part of the string does not have
    * a trailing zero.
    *
    * @param value The string to write.
    * @param length The number of characters to write.
    * @bundle DataStream-write.js
    */
    writeCString(value, length) {
      let i = 0;
      if (length !== void 0) {
        const len = Math.min(value.length, length);
        for (i = 0; i < len; i++) this.writeUint8(value.charCodeAt(i));
        for (; i < length; i++) this.writeUint8(0);
      } else {
        for (i = 0; i < value.length; i++) this.writeUint8(value.charCodeAt(i));
        this.writeUint8(0);
      }
    }
    /**
    * Writes a struct to the DataStream. Takes a structDefinition that gives the
    * types and a struct object that gives the values. Refer to readStruct for the
    * structure of structDefinition.
    *
    * @param structDefinition Type definition of the struct.
    * @param struct The struct data object.
    * @bundle DataStream-write.js
    */
    writeStruct(structDefinition, struct) {
      for (let i = 0; i < structDefinition.length; i++) {
        const [structName, structType] = structDefinition[i];
        const structValue = struct[structName];
        this.writeType(structType, structValue, struct);
      }
    }
    /**
    * Writes object v of type t to the DataStream.
    *
    * @param type Type of data to write.
    * @param value Value of data to write.
    * @param struct Struct to pass to write callback functions.
    * @bundle DataStream-write.js
    */
    writeType(type, value, struct) {
      if (typeof type === "function") return type(this, value);
      else if (typeof type === "object" && !(type instanceof Array)) return type.set(this, value, struct);
      let lengthOverride;
      let charset = "ASCII";
      const pos = this.position;
      let parsedType = type;
      if (typeof type === "string" && /:/.test(type)) {
        const tp = type.split(":");
        parsedType = tp[0];
        lengthOverride = parseInt(tp[1]);
      }
      if (typeof parsedType === "string" && /,/.test(parsedType)) {
        const tp = parsedType.split(",");
        parsedType = tp[0];
        charset = tp[1];
      }
      switch (parsedType) {
        case "uint8":
          this.writeUint8(value);
          break;
        case "int8":
          this.writeInt8(value);
          break;
        case "uint16":
          this.writeUint16(value, this.endianness);
          break;
        case "int16":
          this.writeInt16(value, this.endianness);
          break;
        case "uint32":
          this.writeUint32(value, this.endianness);
          break;
        case "int32":
          this.writeInt32(value, this.endianness);
          break;
        case "float32":
          this.writeFloat32(value, this.endianness);
          break;
        case "float64":
          this.writeFloat64(value, this.endianness);
          break;
        case "uint16be":
          this.writeUint16(value, 1);
          break;
        case "int16be":
          this.writeInt16(value, 1);
          break;
        case "uint32be":
          this.writeUint32(value, 1);
          break;
        case "int32be":
          this.writeInt32(value, 1);
          break;
        case "float32be":
          this.writeFloat32(value, 1);
          break;
        case "float64be":
          this.writeFloat64(value, 1);
          break;
        case "uint16le":
          this.writeUint16(value, 2);
          break;
        case "int16le":
          this.writeInt16(value, 2);
          break;
        case "uint32le":
          this.writeUint32(value, 2);
          break;
        case "int32le":
          this.writeInt32(value, 2);
          break;
        case "float32le":
          this.writeFloat32(value, 2);
          break;
        case "float64le":
          this.writeFloat64(value, 2);
          break;
        case "cstring":
          this.writeCString(value, lengthOverride);
          break;
        case "string":
          this.writeString(value, charset, lengthOverride);
          break;
        case "u16string":
          this.writeUCS2String(value, this.endianness, lengthOverride);
          break;
        case "u16stringle":
          this.writeUCS2String(value, 2, lengthOverride);
          break;
        case "u16stringbe":
          this.writeUCS2String(value, 1, lengthOverride);
          break;
        default:
          if (__privateMethod(this, _DataStream_instances, isTupleType_fn).call(this, parsedType)) {
            const [, ta] = parsedType;
            for (let i = 0; i < value.length; i++) this.writeType(ta, value[i]);
            break;
          } else {
            this.writeStruct(parsedType, value);
            break;
          }
      }
      if (lengthOverride) {
        this.position = pos;
        this._realloc(lengthOverride);
        this.position = pos + lengthOverride;
      }
    }
    /** @bundle DataStream-write.js */
    writeUint64(value) {
      const h = Math.floor(value / MAX_SIZE);
      this.writeUint32(h);
      this.writeUint32(value & 4294967295);
    }
    /** @bundle DataStream-write.js */
    writeUint24(value) {
      this.writeUint8((value & 16711680) >> 16);
      this.writeUint8((value & 65280) >> 8);
      this.writeUint8(value & 255);
    }
    /** @bundle DataStream-write.js */
    adjustUint32(position, value) {
      const pos = this.position;
      this.seek(position);
      this.writeUint32(value);
      this.seek(pos);
    }
    /**
    * Reads a struct of data from the DataStream. The struct is defined as
    * an array of [name, type]-pairs. See the example below:
    *
    * ```ts
    * ds.readStruct([
    *   ['headerTag', 'uint32'], // Uint32 in DataStream endianness.
    *   ['headerTag2', 'uint32be'], // Big-endian Uint32.
    *   ['headerTag3', 'uint32le'], // Little-endian Uint32.
    *   ['array', ['[]', 'uint32', 16]], // Uint32Array of length 16.
    *   ['array2', ['[]', 'uint32', 'array2Length']] // Uint32Array of length array2Length
    * ]);
    * ```
    *
    * The possible values for the type are as follows:
    *
    * ## Number types
    *
    * Unsuffixed number types use DataStream endianness.
    * To explicitly specify endianness, suffix the type with
    * 'le' for little-endian or 'be' for big-endian,
    * e.g. 'int32be' for big-endian int32.
    *
    * - `uint8` -- 8-bit unsigned int
    * - `uint16` -- 16-bit unsigned int
    * - `uint32` -- 32-bit unsigned int
    * - `int8` -- 8-bit int
    * - `int16` -- 16-bit int
    * - `int32` -- 32-bit int
    * - `float32` -- 32-bit float
    * - `float64` -- 64-bit float
    *
    * ## String types
    *
    * - `cstring` -- ASCII string terminated by a zero byte.
    * - `string:N` -- ASCII string of length N.
    * - `string,CHARSET:N` -- String of byteLength N encoded with given CHARSET.
    * - `u16string:N` -- UCS-2 string of length N in DataStream endianness.
    * - `u16stringle:N` -- UCS-2 string of length N in little-endian.
    * - `u16stringbe:N` -- UCS-2 string of length N in big-endian.
    *
    * ## Complex types
    *
    * ### Struct
    * ```ts
    * [[name, type], [name_2, type_2], ..., [name_N, type_N]]
    * ```
    *
    * ### Callback function to read and return data
    * ```ts
    * function(dataStream, struct) {}
    * ```
    *
    * ###  Getter/setter functions
    * to read and return data, handy for using the same struct definition
    * for reading and writing structs.
    * ```ts
    * {
    *    get: function(dataStream, struct) {},
    *    set: function(dataStream, struct) {}
    * }
    * ```
    *
    * ### Array
    * Array of given type and length. The length can be either
    * - a number
    * - a string that references a previously-read field
    * - `*`
    * - a callback: `function(struct, dataStream, type){}`
    *
    * If length is `*`, reads in as many elements as it can.
    * ```ts
    * ['[]', type, length]
    * ```
    *
    * @param structDefinition Struct definition object.
    * @return The read struct. Null if failed to read struct.
    * @bundle DataStream-read-struct.js
    */
    readStruct(structDefinition) {
      const struct = {};
      const p = this.position;
      for (let i = 0; i < structDefinition.length; i += 1) {
        const t = structDefinition[i][1];
        const v = this.readType(t, struct);
        if (!v) {
          if (this.failurePosition === 0) this.failurePosition = this.position;
          this.position = p;
          return;
        }
        struct[structDefinition[i][0]] = v;
      }
      return struct;
    }
    /**
    * Read UCS-2 string of desired length and endianness from the DataStream.
    *
    * @param length The length of the string to read.
    * @param endianness The endianness of the string data in the DataStream.
    * @return The read string.
    * @bundle DataStream-read-struct.js
    */
    readUCS2String(length, endianness) {
      return String.fromCharCode.apply(void 0, this.readUint16Array(length, endianness));
    }
    /**
    * Reads an object of type t from the DataStream, passing struct as the thus-far
    * read struct to possible callbacks that refer to it. Used by readStruct for
    * reading in the values, so the type is one of the readStruct types.
    *
    * @param type Type of the object to read.
    * @param struct Struct to refer to when resolving length references
    *                         and for calling callbacks.
    * @return  Returns the object on successful read, null on unsuccessful.
    * @bundle DataStream-read-struct.js
    */
    readType(type, struct) {
      if (typeof type === "function") return type(this, struct);
      if (typeof type === "object" && !(type instanceof Array)) return type.get(this, struct);
      if (type instanceof Array && type.length !== 3) return this.readStruct(type);
      let value;
      let lengthOverride;
      let charset = "ASCII";
      const pos = this.position;
      let parsedType = type;
      if (typeof parsedType === "string" && /:/.test(parsedType)) {
        const tp = parsedType.split(":");
        parsedType = tp[0];
        lengthOverride = parseInt(tp[1]);
      }
      if (typeof parsedType === "string" && /,/.test(parsedType)) {
        const tp = parsedType.split(",");
        parsedType = tp[0];
        charset = tp[1];
      }
      switch (parsedType) {
        case "uint8":
          value = this.readUint8();
          break;
        case "int8":
          value = this.readInt8();
          break;
        case "uint16":
          value = this.readUint16(this.endianness);
          break;
        case "int16":
          value = this.readInt16(this.endianness);
          break;
        case "uint32":
          value = this.readUint32(this.endianness);
          break;
        case "int32":
          value = this.readInt32(this.endianness);
          break;
        case "float32":
          value = this.readFloat32(this.endianness);
          break;
        case "float64":
          value = this.readFloat64(this.endianness);
          break;
        case "uint16be":
          value = this.readUint16(1);
          break;
        case "int16be":
          value = this.readInt16(1);
          break;
        case "uint32be":
          value = this.readUint32(1);
          break;
        case "int32be":
          value = this.readInt32(1);
          break;
        case "float32be":
          value = this.readFloat32(1);
          break;
        case "float64be":
          value = this.readFloat64(1);
          break;
        case "uint16le":
          value = this.readUint16(2);
          break;
        case "int16le":
          value = this.readInt16(2);
          break;
        case "uint32le":
          value = this.readUint32(2);
          break;
        case "int32le":
          value = this.readInt32(2);
          break;
        case "float32le":
          value = this.readFloat32(2);
          break;
        case "float64le":
          value = this.readFloat64(2);
          break;
        case "cstring":
          value = this.readCString(lengthOverride);
          break;
        case "string":
          value = this.readString(lengthOverride, charset);
          break;
        case "u16string":
          value = this.readUCS2String(lengthOverride, this.endianness);
          break;
        case "u16stringle":
          value = this.readUCS2String(lengthOverride, 2);
          break;
        case "u16stringbe":
          value = this.readUCS2String(lengthOverride, 1);
          break;
        default:
          if (__privateMethod(this, _DataStream_instances, isTupleType_fn).call(this, parsedType)) {
            const [, ta, len] = parsedType;
            const length = typeof len === "function" ? len(struct, this, parsedType) : typeof len === "string" && struct[len] !== void 0 ? parseInt(struct[len]) : typeof len === "number" ? len : len === "*" ? void 0 : parseInt(len);
            if (typeof ta === "string") {
              const tap = ta.replace(/(le|be)$/, "");
              let endianness;
              if (/le$/.test(ta)) endianness = 2;
              else if (/be$/.test(ta)) endianness = 1;
              switch (tap) {
                case "uint8":
                  value = this.readUint8Array(length);
                  break;
                case "uint16":
                  value = this.readUint16Array(length, endianness);
                  break;
                case "uint32":
                  value = this.readUint32Array(length, endianness);
                  break;
                case "int8":
                  value = this.readInt8Array(length);
                  break;
                case "int16":
                  value = this.readInt16Array(length, endianness);
                  break;
                case "int32":
                  value = this.readInt32Array(length, endianness);
                  break;
                case "float32":
                  value = this.readFloat32Array(length, endianness);
                  break;
                case "float64":
                  value = this.readFloat64Array(length, endianness);
                  break;
                case "cstring":
                case "utf16string":
                case "string":
                  if (!length) {
                    value = [];
                    while (!this.isEof()) {
                      const u = this.readType(ta, struct);
                      if (!u) break;
                      value.push(u);
                    }
                  } else {
                    value = new Array(length);
                    for (let i = 0; i < length; i++) value[i] = this.readType(ta, struct);
                  }
                  break;
              }
            } else if (!length) {
              value = [];
              while (true) {
                const pos2 = this.position;
                try {
                  const type2 = this.readType(ta, struct);
                  if (!type2) {
                    this.position = pos2;
                    break;
                  }
                  value.push(type2);
                } catch {
                  this.position = pos2;
                  break;
                }
              }
            } else {
              value = new Array(length);
              for (let i = 0; i < length; i++) {
                const type2 = this.readType(ta, struct);
                if (!type2) return;
                value[i] = type2;
              }
            }
            break;
          }
      }
      if (lengthOverride) this.position = pos + lengthOverride;
      return value;
    }
    /**
    * Maps an Int32Array into the DataStream buffer, swizzling it to native
    * endianness in-place. The current offset from the start of the buffer needs to
    * be a multiple of element size, just like with typed array views.
    *
    * Nice for quickly reading in data. Warning: potentially modifies the buffer
    * contents.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return Int32Array to the DataStream backing buffer.
    * @bundle DataStream-map.js
    */
    mapInt32Array(length, endianness) {
      this._realloc(length * 4);
      const arr = new Int32Array(this._buffer, this.byteOffset + this.position, length);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += length * 4;
      return arr;
    }
    /**
    * Maps an Int16Array into the DataStream buffer, swizzling it to native
    * endianness in-place. The current offset from the start of the buffer needs to
    * be a multiple of element size, just like with typed array views.
    *
    * Nice for quickly reading in data. Warning: potentially modifies the buffer
    * contents.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return Int16Array to the DataStream backing buffer.
    * @bundle DataStream-map.js
    */
    mapInt16Array(length, endianness) {
      this._realloc(length * 2);
      const arr = new Int16Array(this._buffer, this.byteOffset + this.position, length);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += length * 2;
      return arr;
    }
    /**
    * Maps an Int8Array into the DataStream buffer.
    *
    * Nice for quickly reading in data.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return Int8Array to the DataStream backing buffer.
    * @bundle DataStream-map.js
    */
    mapInt8Array(length, _endianness) {
      this._realloc(length * 1);
      const arr = new Int8Array(this._buffer, this.byteOffset + this.position, length);
      this.position += length * 1;
      return arr;
    }
    /**
    * Maps a Uint32Array into the DataStream buffer, swizzling it to native
    * endianness in-place. The current offset from the start of the buffer needs to
    * be a multiple of element size, just like with typed array views.
    *
    * Nice for quickly reading in data. Warning: potentially modifies the buffer
    * contents.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return Uint32Array to the DataStream backing buffer.
    * @bundle DataStream-map.js
    */
    mapUint32Array(length, endianness) {
      this._realloc(length * 4);
      const arr = new Uint32Array(this._buffer, this.byteOffset + this.position, length);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += length * 4;
      return arr;
    }
    /**
    * Maps a Uint16Array into the DataStream buffer, swizzling it to native
    * endianness in-place. The current offset from the start of the buffer needs to
    * be a multiple of element size, just like with typed array views.
    *
    * Nice for quickly reading in data. Warning: potentially modifies the buffer
    * contents.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return Uint16Array to the DataStream backing buffer.
    * @bundle DataStream-map.js
    */
    mapUint16Array(length, endianness) {
      this._realloc(length * 2);
      const arr = new Uint16Array(this._buffer, this.byteOffset + this.position, length);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += length * 2;
      return arr;
    }
    /**
    * Maps a Float64Array into the DataStream buffer, swizzling it to native
    * endianness in-place. The current offset from the start of the buffer needs to
    * be a multiple of element size, just like with typed array views.
    *
    * Nice for quickly reading in data. Warning: potentially modifies the buffer
    * contents.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return Float64Array to the DataStream backing buffer.
    * @bundle DataStream-map.js
    */
    mapFloat64Array(length, endianness) {
      this._realloc(length * 8);
      const arr = new Float64Array(this._buffer, this.byteOffset + this.position, length);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += length * 8;
      return arr;
    }
    /**
    * Maps a Float32Array into the DataStream buffer, swizzling it to native
    * endianness in-place. The current offset from the start of the buffer needs to
    * be a multiple of element size, just like with typed array views.
    *
    * Nice for quickly reading in data. Warning: potentially modifies the buffer
    * contents.
    *
    * @param length Number of elements to map.
    * @param endianness Endianness of the data to read.
    * @return Float32Array to the DataStream backing buffer.
    * @bundle DataStream-map.js
    */
    mapFloat32Array(length, endianness) {
      this._realloc(length * 4);
      const arr = new Float32Array(this._buffer, this.byteOffset + this.position, length);
      _a.arrayToNative(arr, endianness ?? this.endianness);
      this.position += length * 4;
      return arr;
    }
  }, _DataStream_instances = new WeakSet(), isTupleType_fn = function(type) {
    return Array.isArray(type) && type.length === 3 && type[0] === "[]";
  }, _a.ENDIANNESS = new Int8Array(new Int16Array([1]).buffer)[0] > 0 ? 2 : 1, _a);
  function fromCharCodeUint8(uint8arr) {
    const arr = [];
    for (let i = 0; i < uint8arr.length; i++) arr[i] = uint8arr[i];
    return String.fromCharCode.apply(void 0, arr);
  }
  var start = /* @__PURE__ */ new Date();
  var LOG_LEVEL_ERROR = 4;
  var LOG_LEVEL_WARNING = 3;
  var LOG_LEVEL_INFO = 2;
  var LOG_LEVEL_DEBUG = 1;
  var log_level = LOG_LEVEL_ERROR;
  var Log = {
    setLogLevel(level) {
      if (level === this.debug) log_level = LOG_LEVEL_DEBUG;
      else if (level === this.info) log_level = LOG_LEVEL_INFO;
      else if (level === this.warn) log_level = LOG_LEVEL_WARNING;
      else if (level === this.error) log_level = LOG_LEVEL_ERROR;
      else log_level = LOG_LEVEL_ERROR;
    },
    debug(module, msg) {
      if (console.debug === void 0) console.debug = console.log;
      if (LOG_LEVEL_DEBUG >= log_level) console.debug("[" + Log.getDurationString((/* @__PURE__ */ new Date()).getTime() - start.getTime(), 1e3) + "]", "[" + module + "]", msg);
    },
    log(module, _msg) {
      this.debug(module.msg);
    },
    info(module, msg) {
      if (LOG_LEVEL_INFO >= log_level) console.info("[" + Log.getDurationString((/* @__PURE__ */ new Date()).getTime() - start.getTime(), 1e3) + "]", "[" + module + "]", msg);
    },
    warn(module, msg) {
      if (LOG_LEVEL_WARNING >= log_level) console.warn("[" + Log.getDurationString((/* @__PURE__ */ new Date()).getTime() - start.getTime(), 1e3) + "]", "[" + module + "]", msg);
    },
    error(module, msg, isofile) {
      if (isofile?.onError) isofile.onError(module, msg);
      else if (LOG_LEVEL_ERROR >= log_level) console.error("[" + Log.getDurationString((/* @__PURE__ */ new Date()).getTime() - start.getTime(), 1e3) + "]", "[" + module + "]", msg);
    },
    getDurationString(duration, _timescale) {
      let neg;
      function pad(number, length) {
        const a = ("" + number).split(".");
        while (a[0].length < length) a[0] = "0" + a[0];
        return a.join(".");
      }
      if (duration < 0) {
        neg = true;
        duration = -duration;
      } else neg = false;
      let duration_sec = duration / (_timescale || 1);
      const hours = Math.floor(duration_sec / 3600);
      duration_sec -= hours * 3600;
      const minutes = Math.floor(duration_sec / 60);
      duration_sec -= minutes * 60;
      let msec = duration_sec * 1e3;
      duration_sec = Math.floor(duration_sec);
      msec -= duration_sec * 1e3;
      msec = Math.floor(msec);
      return (neg ? "-" : "") + hours + ":" + pad(minutes, 2) + ":" + pad(duration_sec, 2) + "." + pad(msec, 3);
    },
    printRanges(ranges) {
      const length = ranges.length;
      if (length > 0) {
        let str = "";
        for (let i = 0; i < length; i++) {
          if (i > 0) str += ",";
          str += "[" + Log.getDurationString(ranges.start(i)) + "," + Log.getDurationString(ranges.end(i)) + "]";
        }
        return str;
      } else return "(empty)";
    }
  };
  function concatBuffers(buffer1, buffer2) {
    Log.debug("ArrayBuffer", "Trying to create a new buffer of size: " + (buffer1.byteLength + buffer2.byteLength));
    const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
  }
  var MultiBufferStream = class extends DataStream {
    constructor(buffer) {
      super(/* @__PURE__ */ new ArrayBuffer(), 0);
      this.buffers = [];
      this.bufferIndex = -1;
      if (buffer) {
        this.insertBuffer(buffer);
        this.bufferIndex = 0;
      }
    }
    /***********************************************************************************
    *                     Methods for the managnement of the buffers                  *
    *                     (insertion, removal, concatenation, ...)                    *
    ***********************************************************************************/
    initialized() {
      if (this.bufferIndex > -1) return true;
      else if (this.buffers.length > 0) {
        const firstBuffer = this.buffers[0];
        if (firstBuffer.fileStart === 0) {
          this.buffer = firstBuffer;
          this.bufferIndex = 0;
          Log.debug("MultiBufferStream", "Stream ready for parsing");
          return true;
        } else {
          Log.warn("MultiBufferStream", "The first buffer should have a fileStart of 0");
          this.logBufferLevel();
          return false;
        }
      } else {
        Log.warn("MultiBufferStream", "No buffer to start parsing from");
        this.logBufferLevel();
        return false;
      }
    }
    /**
    * Reduces the size of a given buffer, but taking the part between offset and offset+newlength
    * @param  {ArrayBuffer} buffer
    * @param  {Number}      offset    the start of new buffer
    * @param  {Number}      newLength the length of the new buffer
    * @return {ArrayBuffer}           the new buffer
    */
    reduceBuffer(buffer, offset, newLength) {
      const smallB = new Uint8Array(newLength);
      smallB.set(new Uint8Array(buffer, offset, newLength));
      smallB.buffer.fileStart = buffer.fileStart + offset;
      smallB.buffer.usedBytes = 0;
      return smallB.buffer;
    }
    /**
    * Inserts the new buffer in the sorted list of buffers,
    *  making sure, it is not overlapping with existing ones (possibly reducing its size).
    *  if the new buffer overrides/replaces the 0-th buffer (for instance because it is bigger),
    *  updates the DataStream buffer for parsing
    */
    insertBuffer(ab) {
      let to_add = true;
      let i = 0;
      for (; i < this.buffers.length; i++) {
        const b = this.buffers[i];
        if (ab.fileStart <= b.fileStart) {
          if (ab.fileStart === b.fileStart) if (ab.byteLength > b.byteLength) {
            this.buffers.splice(i, 1);
            i--;
            continue;
          } else Log.warn("MultiBufferStream", "Buffer (fileStart: " + ab.fileStart + " - Length: " + ab.byteLength + ") already appended, ignoring");
          else {
            if (ab.fileStart + ab.byteLength <= b.fileStart) {
            } else ab = this.reduceBuffer(ab, 0, b.fileStart - ab.fileStart);
            Log.debug("MultiBufferStream", "Appending new buffer (fileStart: " + ab.fileStart + " - Length: " + ab.byteLength + ")");
            this.buffers.splice(i, 0, ab);
            if (i === 0) this.buffer = ab;
          }
          to_add = false;
          break;
        } else if (ab.fileStart < b.fileStart + b.byteLength) {
          const offset = b.fileStart + b.byteLength - ab.fileStart;
          const newLength = ab.byteLength - offset;
          if (newLength > 0) ab = this.reduceBuffer(ab, offset, newLength);
          else {
            to_add = false;
            break;
          }
        }
      }
      if (to_add) {
        Log.debug("MultiBufferStream", "Appending new buffer (fileStart: " + ab.fileStart + " - Length: " + ab.byteLength + ")");
        this.buffers.push(ab);
        if (i === 0) this.buffer = ab;
      }
    }
    /**
    * Displays the status of the buffers (number and used bytes)
    * @param  {Object} info callback method for display
    */
    logBufferLevel(info) {
      const ranges = [];
      let bufferedString = "";
      let range;
      let used = 0;
      let total = 0;
      for (let i = 0; i < this.buffers.length; i++) {
        const buffer = this.buffers[i];
        if (i === 0) {
          range = {
            start: buffer.fileStart,
            end: buffer.fileStart + buffer.byteLength
          };
          ranges.push(range);
          bufferedString += "[" + range.start + "-";
        } else if (range.end === buffer.fileStart) range.end = buffer.fileStart + buffer.byteLength;
        else {
          range = {
            start: buffer.fileStart,
            end: buffer.fileStart + buffer.byteLength
          };
          bufferedString += ranges[ranges.length - 1].end - 1 + "], [" + range.start + "-";
          ranges.push(range);
        }
        used += buffer.usedBytes;
        total += buffer.byteLength;
      }
      if (ranges.length > 0) bufferedString += range.end - 1 + "]";
      const log2 = info ? Log.info : Log.debug;
      if (this.buffers.length === 0) log2("MultiBufferStream", "No more buffer in memory");
      else log2("MultiBufferStream", "" + this.buffers.length + " stored buffer(s) (" + used + "/" + total + " bytes), continuous ranges: " + bufferedString);
    }
    cleanBuffers() {
      for (let i = 0; i < this.buffers.length; i++) {
        const buffer = this.buffers[i];
        if (buffer.usedBytes === buffer.byteLength) {
          Log.debug("MultiBufferStream", "Removing buffer #" + i);
          this.buffers.splice(i, 1);
          i--;
        }
      }
    }
    mergeNextBuffer() {
      if (this.bufferIndex + 1 < this.buffers.length) {
        const next_buffer = this.buffers[this.bufferIndex + 1];
        if (next_buffer.fileStart === this.buffer.fileStart + this.buffer.byteLength) {
          const oldLength = this.buffer.byteLength;
          const oldUsedBytes = this.buffer.usedBytes;
          const oldFileStart = this.buffer.fileStart;
          this.buffers[this.bufferIndex] = concatBuffers(this.buffer, next_buffer);
          this.buffer = this.buffers[this.bufferIndex];
          this.buffers.splice(this.bufferIndex + 1, 1);
          this.buffer.usedBytes = oldUsedBytes;
          this.buffer.fileStart = oldFileStart;
          Log.debug("ISOFile", "Concatenating buffer for box parsing (length: " + oldLength + "->" + this.buffer.byteLength + ")");
          return true;
        } else return false;
      } else return false;
    }
    /*************************************************************************
    *                        Seek-related functions                         *
    *************************************************************************/
    /**
    * Finds the buffer that holds the given file position
    * @param  {Boolean} fromStart    indicates if the search should start from the current buffer (false)
    *                                or from the first buffer (true)
    * @param  {Number}  filePosition position in the file to seek to
    * @param  {Boolean} markAsUsed   indicates if the bytes in between the current position and the seek position
    *                                should be marked as used for garbage collection
    * @return {Number}               the index of the buffer holding the seeked file position, -1 if not found.
    */
    findPosition(fromStart, filePosition, markAsUsed) {
      let index = -1;
      let i = fromStart === true ? 0 : this.bufferIndex;
      while (i < this.buffers.length) {
        const abuffer2 = this.buffers[i];
        if (abuffer2 && abuffer2.fileStart <= filePosition) {
          index = i;
          if (markAsUsed) {
            if (abuffer2.fileStart + abuffer2.byteLength <= filePosition) abuffer2.usedBytes = abuffer2.byteLength;
            else abuffer2.usedBytes = filePosition - abuffer2.fileStart;
            this.logBufferLevel();
          }
        } else break;
        i++;
      }
      if (index === -1) return -1;
      const abuffer = this.buffers[index];
      if (abuffer.fileStart + abuffer.byteLength >= filePosition) {
        Log.debug("MultiBufferStream", "Found position in existing buffer #" + index);
        return index;
      } else return -1;
    }
    /**
    * Finds the largest file position contained in a buffer or in the next buffers if they are contiguous (no gap)
    * starting from the given buffer index or from the current buffer if the index is not given
    *
    * @param  {Number} inputindex Index of the buffer to start from
    * @return {Number}            The largest file position found in the buffers
    */
    findEndContiguousBuf(inputindex) {
      const index = inputindex !== void 0 ? inputindex : this.bufferIndex;
      let currentBuf = this.buffers[index];
      if (this.buffers.length > index + 1) for (let i = index + 1; i < this.buffers.length; i++) {
        const nextBuf = this.buffers[i];
        if (nextBuf.fileStart === currentBuf.fileStart + currentBuf.byteLength) currentBuf = nextBuf;
        else break;
      }
      return currentBuf.fileStart + currentBuf.byteLength;
    }
    /**
    * Returns the largest file position contained in the buffers, larger than the given position
    * @param  {Number} pos the file position to start from
    * @return {Number}     the largest position in the current buffer or in the buffer and the next contiguous
    *                      buffer that holds the given position
    */
    getEndFilePositionAfter(pos) {
      const index = this.findPosition(true, pos, false);
      if (index !== -1) return this.findEndContiguousBuf(index);
      else return pos;
    }
    /*************************************************************************
    *                  Garbage collection related functions                 *
    *************************************************************************/
    /**
    * Marks a given number of bytes as used in the current buffer for garbage collection
    * @param {Number} nbBytes
    */
    addUsedBytes(nbBytes) {
      this.buffer.usedBytes += nbBytes;
      this.logBufferLevel();
    }
    /**
    * Marks the entire current buffer as used, ready for garbage collection
    */
    setAllUsedBytes() {
      this.buffer.usedBytes = this.buffer.byteLength;
      this.logBufferLevel();
    }
    /*************************************************************************
    *          Common API between MultiBufferStream and SimpleStream        *
    *************************************************************************/
    /**
    * Tries to seek to a given file position
    * if possible, repositions the parsing from there and returns true
    * if not possible, does not change anything and returns false
    * @param  {Number}  filePosition position in the file to seek to
    * @param  {Boolean} fromStart    indicates if the search should start from the current buffer (false)
    *                                or from the first buffer (true)
    * @param  {Boolean} markAsUsed   indicates if the bytes in between the current position and the seek position
    *                                should be marked as used for garbage collection
    * @return {Boolean}              true if the seek succeeded, false otherwise
    */
    seek(filePosition, fromStart, markAsUsed) {
      const index = this.findPosition(fromStart, filePosition, markAsUsed);
      if (index !== -1) {
        this.buffer = this.buffers[index];
        this.bufferIndex = index;
        this.position = filePosition - this.buffer.fileStart;
        Log.debug("MultiBufferStream", "Repositioning parser at buffer position: " + this.position);
        return true;
      } else {
        Log.debug("MultiBufferStream", "Position " + filePosition + " not found in buffered data");
        return false;
      }
    }
    /**
    * Returns the current position in the file
    * @return {Number} the position in the file
    */
    getPosition() {
      if (this.bufferIndex === -1 || this.buffers[this.bufferIndex] === void 0) return 0;
      return this.buffers[this.bufferIndex].fileStart + this.position;
    }
    /**
    * Returns the length of the current buffer
    * @return {Number} the length of the current buffer
    */
    getLength() {
      return this.byteLength;
    }
    getEndPosition() {
      if (this.bufferIndex === -1 || this.buffers[this.bufferIndex] === void 0) return 0;
      return this.buffers[this.bufferIndex].fileStart + this.byteLength;
    }
    getAbsoluteEndPosition() {
      if (this.buffers.length === 0) return 0;
      const lastBuffer = this.buffers[this.buffers.length - 1];
      return lastBuffer.fileStart + lastBuffer.byteLength;
    }
  };
  var _type, _a2;
  var Box = (_a2 = class {
    constructor(size = 0) {
      __privateAdd(this, _type);
      this.size = size;
    }
    get type() {
      return this.constructor.fourcc ?? __privateGet(this, _type);
    }
    set type(value) {
      __privateSet(this, _type, value);
    }
    addBox(box2) {
      if (!this.boxes) this.boxes = [];
      this.boxes.push(box2);
      if (this[box2.type + "s"]) this[box2.type + "s"].push(box2);
      else this[box2.type] = box2;
      return box2;
    }
    set(prop, value) {
      this[prop] = value;
      return this;
    }
    addEntry(value, _prop) {
      const prop = _prop || "entries";
      if (!this[prop]) this[prop] = [];
      this[prop].push(value);
      return this;
    }
    /** @bundle box-write.js */
    writeHeader(stream, msg) {
      this.size += 8;
      if (this.size > MAX_UINT32 || this.original_size === 1) this.size += 8;
      if (this.type === "uuid") this.size += 16;
      Log.debug("BoxWriter", "Writing box " + this.type + " of size: " + this.size + " at position " + stream.getPosition() + (msg || ""));
      if (this.original_size === 0) stream.writeUint32(0);
      else if (this.size > MAX_UINT32 || this.original_size === 1) stream.writeUint32(1);
      else {
        this.sizePosition = stream.getPosition();
        stream.writeUint32(this.size);
      }
      stream.writeString(this.type, void 0, 4);
      if (this.type === "uuid") {
        const uuidBytes = /* @__PURE__ */ new Uint8Array(16);
        for (let i = 0; i < 16; i++) uuidBytes[i] = parseInt(this.uuid.substring(i * 2, i * 2 + 2), 16);
        stream.writeUint8Array(uuidBytes);
      }
      if (this.size > MAX_UINT32 || this.original_size === 1) {
        this.sizePosition = stream.getPosition();
        stream.writeUint64(this.size);
      }
    }
    /** @bundle box-write.js */
    write(stream) {
      if (this.type === "mdat") {
        const box2 = this;
        if (box2.stream) {
          this.size = box2.stream.getAbsoluteEndPosition();
          this.writeHeader(stream);
          for (const buffer of box2.stream.buffers) {
            const u8 = new Uint8Array(buffer);
            stream.writeUint8Array(u8);
          }
        } else if (box2.data) {
          this.size = box2.data.length;
          this.writeHeader(stream);
          stream.writeUint8Array(box2.data);
        }
      } else {
        this.size = this.data ? this.data.length : 0;
        this.writeHeader(stream);
        if (this.data) stream.writeUint8Array(this.data);
      }
    }
    /** @bundle box-print.js */
    printHeader(output) {
      this.size += 8;
      if (this.size > MAX_UINT32) this.size += 8;
      if (this.type === "uuid") this.size += 16;
      output.log(output.indent + "size:" + this.size);
      output.log(output.indent + "type:" + this.type);
    }
    /** @bundle box-print.js */
    print(output) {
      this.printHeader(output);
    }
    /** @bundle box-parse.js */
    parse(stream) {
      if (this.type !== "mdat") this.data = stream.readUint8Array(this.size - this.hdr_size);
      else if (this.size === 0) stream.seek(stream.getEndPosition());
      else stream.seek(this.start + this.size);
    }
    /** @bundle box-parse.js */
    parseDataAndRewind(stream) {
      this.data = stream.readUint8Array(this.size - this.hdr_size);
      stream.seek(this.start + this.hdr_size);
    }
    /** @bundle box-parse.js */
    parseLanguage(stream) {
      this.language = stream.readUint16();
      const chars = [];
      chars[0] = this.language >> 10 & 31;
      chars[1] = this.language >> 5 & 31;
      chars[2] = this.language & 31;
      this.languageString = String.fromCharCode(chars[0] + 96, chars[1] + 96, chars[2] + 96);
    }
    /** @bundle isofile-advanced-creation.js */
    computeSize(stream_) {
      const stream = stream_ || new MultiBufferStream();
      this.write(stream);
    }
    isEndOfBox(stream) {
      return stream.getPosition() === this.start + this.size;
    }
  }, _type = new WeakMap(), _a2.registryId = /* @__PURE__ */ Symbol.for("BoxIdentifier"), _a2);
  var FullBox = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.flags = 0;
      this.version = 0;
    }
    /** @bundle box-write.js */
    writeHeader(stream) {
      this.size += 4;
      super.writeHeader(stream, " v=" + this.version + " f=" + this.flags);
      stream.writeUint8(this.version);
      stream.writeUint24(this.flags);
    }
    /** @bundle box-print.js */
    printHeader(output) {
      this.size += 4;
      super.printHeader(output);
      output.log(output.indent + "version:" + this.version);
      output.log(output.indent + "flags:" + this.flags);
    }
    /** @bundle box-parse.js */
    parseDataAndRewind(stream) {
      this.parseFullHeader(stream);
      this.data = stream.readUint8Array(this.size - this.hdr_size);
      this.hdr_size -= 4;
      stream.seek(this.start + this.hdr_size);
    }
    /** @bundle box-parse.js */
    parseFullHeader(stream) {
      this.version = stream.readUint8();
      this.flags = stream.readUint24();
      this.hdr_size += 4;
    }
    /** @bundle box-parse.js */
    parse(stream) {
      this.parseFullHeader(stream);
      this.data = stream.readUint8Array(this.size - this.hdr_size);
    }
  };
  var _a3;
  var SampleGroupEntry = (_a3 = class {
    constructor(grouping_type) {
      this.grouping_type = grouping_type;
    }
    /** @bundle writing/samplegroups/samplegroup.js */
    write(stream) {
      stream.writeUint8Array(this.data);
    }
    /** @bundle parsing/samplegroups/samplegroup.js */
    parse(stream) {
      Log.warn("BoxParser", `Unknown sample group type: '${this.grouping_type}'`);
      this.data = stream.readUint8Array(this.description_length);
    }
  }, _a3.registryId = /* @__PURE__ */ Symbol.for("SampleGroupEntryIdentifier"), _a3);
  var TrackGroupTypeBox = class extends FullBox {
    /** @bundle parsing/TrackGroup.js */
    parse(stream) {
      this.parseFullHeader(stream);
      this.track_group_id = stream.readUint32();
    }
  };
  var SingleItemTypeReferenceBox = class extends Box {
    constructor(fourcc2, size, box_name, hdr_size, start2) {
      super(size);
      this.box_name = box_name;
      this.hdr_size = hdr_size;
      this.start = start2;
      this.type = fourcc2;
    }
    parse(stream) {
      this.from_item_ID = stream.readUint16();
      const count = stream.readUint16();
      this.references = [];
      for (let i = 0; i < count; i++) this.references[i] = { to_item_ID: stream.readUint16() };
    }
  };
  var SingleItemTypeReferenceBoxLarge = class extends Box {
    constructor(fourcc2, size, box_name, hdr_size, start2) {
      super(size);
      this.box_name = box_name;
      this.hdr_size = hdr_size;
      this.start = start2;
      this.type = fourcc2;
    }
    parse(stream) {
      this.from_item_ID = stream.readUint32();
      const count = stream.readUint16();
      this.references = [];
      for (let i = 0; i < count; i++) this.references[i] = { to_item_ID: stream.readUint32() };
    }
  };
  var TrackReferenceTypeBox = class extends Box {
    constructor(fourcc2, size, hdr_size, start2) {
      super(size);
      this.hdr_size = hdr_size;
      this.start = start2;
      this.type = fourcc2;
    }
    parse(stream) {
      this.track_ids = stream.readUint32Array((this.size - this.hdr_size) / 4);
    }
    /** @bundle box-write.js */
    write(stream) {
      this.size = this.track_ids.length * 4;
      this.writeHeader(stream);
      stream.writeUint32Array(this.track_ids);
    }
  };
  var DIFF_BOXES_PROP_NAMES = [
    "boxes",
    "entries",
    "references",
    "subsamples",
    "items",
    "item_infos",
    "extents",
    "associations",
    "subsegments",
    "ranges",
    "seekLists",
    "seekPoints",
    "esd",
    "levels"
  ];
  var DIFF_PRIMITIVE_ARRAY_PROP_NAMES = [
    "compatible_brands",
    "matrix",
    "opcolor",
    "sample_counts",
    "sample_deltas",
    "first_chunk",
    "samples_per_chunk",
    "sample_sizes",
    "chunk_offsets",
    "sample_offsets",
    "sample_description_index",
    "sample_duration"
  ];
  function boxEqualFields(box_a, box_b) {
    if (box_a && !box_b) return false;
    let prop;
    for (prop in box_a) if (DIFF_BOXES_PROP_NAMES.find((name) => name === prop)) continue;
    else if (box_a[prop] instanceof Box || box_b[prop] instanceof Box) continue;
    else if (typeof box_a[prop] === "undefined" || typeof box_b[prop] === "undefined") continue;
    else if (typeof box_a[prop] === "function" || typeof box_b[prop] === "function") continue;
    else if ("subBoxNames" in box_a && box_a.subBoxNames.indexOf(prop.slice(0, 4)) > -1 || "subBoxNames" in box_b && box_b.subBoxNames.indexOf(prop.slice(0, 4)) > -1) continue;
    else if (prop === "data" || prop === "start" || prop === "size" || prop === "creation_time" || prop === "modification_time") continue;
    else if (DIFF_PRIMITIVE_ARRAY_PROP_NAMES.find((name) => name === prop)) continue;
    else if (box_a[prop] !== box_b[prop]) return false;
    return true;
  }
  function boxEqual(box_a, box_b) {
    if (!boxEqualFields(box_a, box_b)) return false;
    for (let j = 0; j < DIFF_BOXES_PROP_NAMES.length; j++) {
      const name = DIFF_BOXES_PROP_NAMES[j];
      if (box_a[name] && box_b[name]) {
        if (!boxEqual(box_a[name], box_b[name])) return false;
      }
    }
    return true;
  }
  function getRegistryId(boxClass) {
    let current = boxClass;
    while (current) {
      if ("registryId" in current) return current["registryId"];
      current = Object.getPrototypeOf(current);
    }
  }
  var isSampleGroupEntry = (value) => {
    const symbol = /* @__PURE__ */ Symbol.for("SampleGroupEntryIdentifier");
    return getRegistryId(value) === symbol;
  };
  var isSampleEntry = (value) => {
    const symbol = /* @__PURE__ */ Symbol.for("SampleEntryIdentifier");
    return getRegistryId(value) === symbol;
  };
  var isBox = (value) => {
    const symbol = /* @__PURE__ */ Symbol.for("BoxIdentifier");
    return getRegistryId(value) === symbol;
  };
  var BoxRegistry = {
    uuid: {},
    sampleEntry: {},
    sampleGroupEntry: {},
    box: {}
  };
  function registerBoxes(registry) {
    const localRegistry = {
      uuid: {},
      sampleEntry: {},
      sampleGroupEntry: {},
      box: {}
    };
    for (const [key, value] of Object.entries(registry)) {
      if (isSampleGroupEntry(value)) {
        const groupingType = "grouping_type" in value ? value.grouping_type : void 0;
        if (!groupingType) throw new Error(`SampleGroupEntry class ${key} does not have a valid static grouping_type. Please ensure it is defined correctly.`);
        if (groupingType in localRegistry.sampleGroupEntry) throw new Error(`SampleGroupEntry class ${key} has a grouping_type that is already registered. Please ensure it is unique.`);
        localRegistry.sampleGroupEntry[groupingType] = value;
        continue;
      }
      if (isSampleEntry(value)) {
        const fourcc2 = "fourcc" in value ? value.fourcc : void 0;
        if (!fourcc2) throw new Error(`SampleEntry class ${key} does not have a valid static fourcc. Please ensure it is defined correctly.`);
        if (fourcc2 in localRegistry.sampleEntry) throw new Error(`SampleEntry class ${key} has a fourcc that is already registered. Please ensure it is unique.`);
        localRegistry.sampleEntry[fourcc2] = value;
        continue;
      }
      if (isBox(value)) {
        const fourcc2 = "fourcc" in value ? value.fourcc : void 0;
        const uuid = "uuid" in value ? value.uuid : void 0;
        if (fourcc2 === "uuid") {
          if (!uuid) throw new Error(`Box class ${key} has a fourcc of 'uuid' but does not have a valid uuid. Please ensure it is defined correctly.`);
          if (uuid in localRegistry.uuid) throw new Error(`Box class ${key} has a uuid that is already registered. Please ensure it is unique.`);
          localRegistry.uuid[uuid] = value;
          continue;
        }
        localRegistry.box[fourcc2] = value;
        continue;
      }
      throw new Error(`Box class ${key} does not have a valid static fourcc, uuid, or grouping_type. Please ensure it is defined correctly.`);
    }
    BoxRegistry.uuid = { ...localRegistry.uuid };
    BoxRegistry.sampleEntry = { ...localRegistry.sampleEntry };
    BoxRegistry.sampleGroupEntry = { ...localRegistry.sampleGroupEntry };
    BoxRegistry.box = { ...localRegistry.box };
    return BoxRegistry;
  }
  var DescriptorRegistry = {};
  function registerDescriptors(registry) {
    Object.entries(registry).forEach(([key, value]) => DescriptorRegistry[key] = value);
    return DescriptorRegistry;
  }
  function parseUUID(stream) {
    return parseHex16(stream);
  }
  function parseHex16(stream) {
    let hex16 = "";
    for (let i = 0; i < 16; i++) {
      const hex = stream.readUint8().toString(16);
      hex16 += hex.length === 1 ? "0" + hex : hex;
    }
    return hex16;
  }
  function parseOneBox(stream, headerOnly, parentSize) {
    let box2;
    let originalSize;
    const start2 = stream.getPosition();
    let hdr_size = 0;
    let uuid;
    if (stream.getEndPosition() - start2 < 8) {
      Log.debug("BoxParser", "Not enough data in stream to parse the type and size of the box");
      return { code: 0 };
    }
    if (parentSize && parentSize < 8) {
      Log.debug("BoxParser", "Not enough bytes left in the parent box to parse a new box");
      return { code: 0 };
    }
    let size = stream.readUint32();
    const type = stream.readString(4);
    if (type.length !== 4 || !/^[\x20-\x7E]{4}$/.test(type)) {
      Log.error("BoxParser", `Invalid box type: '${type}'`);
      return {
        code: -1,
        start: start2,
        type
      };
    }
    let box_type = type;
    Log.debug("BoxParser", "Found box of type '" + type + "' and size " + size + " at position " + start2);
    hdr_size = 8;
    if (type === "uuid") {
      if (stream.getEndPosition() - stream.getPosition() < 16 || parentSize - hdr_size < 16) {
        stream.seek(start2);
        Log.debug("BoxParser", "Not enough bytes left in the parent box to parse a UUID box");
        return { code: 0 };
      }
      uuid = parseUUID(stream);
      hdr_size += 16;
      box_type = uuid;
    }
    if (size === 1) {
      if (stream.getEndPosition() - stream.getPosition() < 8 || parentSize && parentSize - hdr_size < 8) {
        stream.seek(start2);
        Log.warn("BoxParser", 'Not enough data in stream to parse the extended size of the "' + type + '" box');
        return { code: 0 };
      }
      originalSize = size;
      size = stream.readUint64();
      hdr_size += 8;
    } else if (size === 0) if (parentSize) size = parentSize;
    else if (type !== "mdat") {
      Log.error("BoxParser", "Unlimited box size not supported for type: '" + type + "'");
      box2 = new Box(size);
      box2.type = type;
      return {
        code: 1,
        box: box2,
        size: box2.size
      };
    } else size = stream.getEndPosition() - start2;
    if (size !== 0 && size < hdr_size) {
      Log.error("BoxParser", "Box of type " + type + " has an invalid size " + size + " (too small to be a box)");
      return {
        code: 0,
        type,
        size,
        hdr_size,
        start: start2
      };
    }
    if (size !== 0 && parentSize && size > parentSize) {
      Log.error("BoxParser", "Box of type '" + type + "' has a size " + size + " greater than its container size " + parentSize);
      return {
        code: 0,
        type,
        size,
        hdr_size,
        start: start2
      };
    }
    if (size !== 0 && start2 + size > stream.getEndPosition()) {
      stream.seek(start2);
      Log.info("BoxParser", "Not enough data in stream to parse the entire '" + type + "' box");
      return {
        code: 0,
        type,
        size,
        hdr_size,
        start: start2,
        original_size: originalSize
      };
    }
    if (headerOnly) return {
      code: 1,
      type,
      size,
      hdr_size,
      start: start2
    };
    else if (type in BoxRegistry.box) box2 = new BoxRegistry.box[type](size);
    else if (type !== "uuid") {
      Log.warn("BoxParser", `Unknown box type: '${type}'`);
      box2 = new Box(size);
      box2.type = type;
      box2.has_unparsed_data = true;
    } else if (uuid in BoxRegistry.uuid) box2 = new BoxRegistry.uuid[uuid](size);
    else {
      Log.warn("BoxParser", `Unknown UUID box type: '${uuid}'`);
      box2 = new Box(size);
      box2.type = type;
      box2.uuid = uuid;
      box2.has_unparsed_data = true;
    }
    box2.original_size = originalSize;
    box2.hdr_size = hdr_size;
    box2.start = start2;
    if (box2.write === Box.prototype.write && box2.type !== "mdat") {
      Log.info("BoxParser", "'" + box_type + "' box writing not yet implemented, keeping unparsed data in memory for later write");
      box2.parseDataAndRewind(stream);
    }
    box2.parse(stream);
    const diff = stream.getPosition() - (box2.start + box2.size);
    if (diff < 0) {
      Log.warn("BoxParser", "Parsing of box '" + box_type + "' did not read the entire indicated box data size (missing " + -diff + " bytes), seeking forward");
      stream.seek(box2.start + box2.size);
    } else if (diff > 0 && box2.size !== 0) {
      Log.error("BoxParser", "Parsing of box '" + box_type + "' read " + diff + " more bytes than the indicated box data size, seeking backwards");
      stream.seek(box2.start + box2.size);
    }
    return {
      code: 1,
      box: box2,
      size: box2.size
    };
  }
  var ContainerBox = class extends Box {
    /** @bundle box-write.js */
    write(stream) {
      this.size = 0;
      this.writeHeader(stream);
      if (this.boxes) {
        for (let i = 0; i < this.boxes.length; i++) if (this.boxes[i]) {
          this.boxes[i].write(stream);
          this.size += this.boxes[i].size;
        }
      }
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    }
    /** @bundle box-print.js */
    print(output) {
      this.printHeader(output);
      for (let i = 0; i < this.boxes.length; i++) if (this.boxes[i]) {
        const prev_indent = output.indent;
        output.indent += " ";
        this.boxes[i].print(output);
        output.indent = prev_indent;
      }
    }
    /** @bundle box-parse.js */
    parse(stream) {
      let ret;
      while (stream.getPosition() < this.start + this.size) {
        ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret.code === 1) {
          const box2 = ret.box;
          if (!this.boxes) this.boxes = [];
          this.boxes.push(box2);
          if (this.subBoxNames && this.subBoxNames.indexOf(box2.type) !== -1) {
            const fourcc2 = this.subBoxNames[this.subBoxNames.indexOf(box2.type)] + "s";
            if (!this[fourcc2]) this[fourcc2] = [];
            this[fourcc2].push(box2);
          } else {
            const box_type = box2.type !== "uuid" ? box2.type : box2.uuid;
            if (this[box_type]) Log.warn("ContainerBox", `Box of type ${box_type} already exists in container box ${this.type}.`);
            else this[box_type] = box2;
          }
        } else return;
      }
    }
  };
  var _a4;
  var SampleEntry = (_a4 = class extends ContainerBox {
    constructor(size, hdr_size, start2) {
      super(size);
      this.hdr_size = hdr_size;
      this.start = start2;
    }
    /** @bundle box-codecs.js */
    isVideo() {
      return false;
    }
    /** @bundle box-codecs.js */
    isAudio() {
      return false;
    }
    /** @bundle box-codecs.js */
    isSubtitle() {
      return false;
    }
    /** @bundle box-codecs.js */
    isMetadata() {
      return false;
    }
    /** @bundle box-codecs.js */
    isHint() {
      return false;
    }
    /** @bundle box-codecs.js */
    getCodec() {
      return this.type.replace(".", "");
    }
    /** @bundle box-codecs.js */
    getWidth() {
      return "";
    }
    /** @bundle box-codecs.js */
    getHeight() {
      return "";
    }
    /** @bundle box-codecs.js */
    getChannelCount() {
      return "";
    }
    /** @bundle box-codecs.js */
    getSampleRate() {
      return "";
    }
    /** @bundle box-codecs.js */
    getSampleSize() {
      return "";
    }
    /** @bundle parsing/sampleentries/sampleentry.js */
    parseHeader(stream) {
      stream.readUint8Array(6);
      this.data_reference_index = stream.readUint16();
      this.hdr_size += 8;
    }
    /** @bundle parsing/sampleentries/sampleentry.js */
    parse(stream) {
      this.parseHeader(stream);
      this.data = stream.readUint8Array(this.size - this.hdr_size);
    }
    /** @bundle parsing/sampleentries/sampleentry.js */
    parseDataAndRewind(stream) {
      this.parseHeader(stream);
      this.data = stream.readUint8Array(this.size - this.hdr_size);
      this.hdr_size -= 8;
      stream.seek(this.start + this.hdr_size);
    }
    /** @bundle parsing/sampleentries/sampleentry.js */
    parseFooter(stream) {
      super.parse(stream);
    }
    /** @bundle writing/sampleentry.js */
    writeHeader(stream) {
      this.size = 8;
      super.writeHeader(stream);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint16(this.data_reference_index);
    }
    /** @bundle writing/sampleentry.js */
    writeFooter(stream) {
      if (this.boxes) for (let i = 0; i < this.boxes.length; i++) {
        this.boxes[i].write(stream);
        this.size += this.boxes[i].size;
      }
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    }
    /** @bundle writing/sampleentry.js */
    write(stream) {
      this.writeHeader(stream);
      stream.writeUint8Array(this.data);
      this.size += this.data.length;
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    }
  }, _a4.registryId = /* @__PURE__ */ Symbol.for("SampleEntryIdentifier"), _a4);
  var HintSampleEntry = class extends SampleEntry {
  };
  var MetadataSampleEntry = class extends SampleEntry {
    /** @bundle box-codecs.js */
    isMetadata() {
      return true;
    }
  };
  var SubtitleSampleEntry = class extends SampleEntry {
    /** @bundle box-codecs.js */
    isSubtitle() {
      return true;
    }
  };
  var TextSampleEntry = class extends SampleEntry {
  };
  var VisualSampleEntry = class extends SampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      stream.readUint16();
      stream.readUint16();
      stream.readUint32Array(3);
      this.width = stream.readUint16();
      this.height = stream.readUint16();
      this.horizresolution = stream.readUint32();
      this.vertresolution = stream.readUint32();
      stream.readUint32();
      this.frame_count = stream.readUint16();
      const compressorname_length = Math.min(31, stream.readUint8());
      this.compressorname = stream.readString(compressorname_length);
      if (compressorname_length < 31) stream.readString(31 - compressorname_length);
      this.depth = stream.readUint16();
      stream.readUint16();
      this.parseFooter(stream);
    }
    /** @bundle box-codecs.js */
    isVideo() {
      return true;
    }
    /** @bundle box-codecs.js */
    getWidth() {
      return this.width;
    }
    /** @bundle box-codecs.js */
    getHeight() {
      return this.height;
    }
    /** @bundle writing/sampleentries/sampleentry.js */
    write(stream) {
      this.writeHeader(stream);
      this.size += 70;
      stream.writeUint16(0);
      stream.writeUint16(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint16(this.width);
      stream.writeUint16(this.height);
      stream.writeUint32(this.horizresolution);
      stream.writeUint32(this.vertresolution);
      stream.writeUint32(0);
      stream.writeUint16(this.frame_count);
      stream.writeUint8(Math.min(31, this.compressorname.length));
      stream.writeString(this.compressorname, void 0, 31);
      stream.writeUint16(this.depth);
      stream.writeInt16(-1);
      this.writeFooter(stream);
    }
  };
  var AudioSampleEntry = class extends SampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      this.version = stream.readUint16();
      stream.readUint16();
      stream.readUint32();
      this.channel_count = stream.readUint16();
      this.samplesize = stream.readUint16();
      stream.readUint16();
      stream.readUint16();
      this.samplerate = stream.readUint32() / 65536;
      if (stream.isofile?.ftyp?.major_brand.includes("qt")) {
        if (this.version === 1) this.extensions = stream.readUint8Array(16);
        else if (this.version === 2) this.extensions = stream.readUint8Array(36);
      }
      this.parseFooter(stream);
    }
    /** @bundle box-codecs.js */
    isAudio() {
      return true;
    }
    /** @bundle box-codecs.js */
    getChannelCount() {
      return this.channel_count;
    }
    /** @bundle box-codecs.js */
    getSampleRate() {
      return this.samplerate;
    }
    /** @bundle box-codecs.js */
    getSampleSize() {
      return this.samplesize;
    }
    /** @bundle writing/sampleentry.js */
    write(stream) {
      this.writeHeader(stream);
      this.size += 20;
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint16(this.channel_count);
      stream.writeUint16(this.samplesize);
      stream.writeUint16(0);
      stream.writeUint16(0);
      stream.writeUint32(this.samplerate << 16);
      this.writeFooter(stream);
    }
  };
  var SystemSampleEntry = class extends SampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      this.parseFooter(stream);
    }
    /** @bundle writing/sampleentry.js */
    write(stream) {
      this.writeHeader(stream);
      this.writeFooter(stream);
    }
  };
  var ParameterSetArray = class extends Array {
    toString() {
      let str = "<table class='inner-table'>";
      str += "<thead><tr><th>length</th><th>nalu_data</th></tr></thead>";
      str += "<tbody>";
      for (let i = 0; i < this.length; i++) {
        const nalu = this[i];
        str += "<tr>";
        str += "<td>" + nalu.length + "</td>";
        str += "<td>";
        str += nalu.data.reduce(function(str2, byte) {
          return str2 + byte.toString(16).padStart(2, "0");
        }, "0x");
        str += "</td></tr>";
      }
      str += "</tbody></table>";
      return str;
    }
  };
  var _a5;
  var avcCBox = (_a5 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "AVCConfigurationBox";
    }
    parse(stream) {
      this.configurationVersion = stream.readUint8();
      this.AVCProfileIndication = stream.readUint8();
      this.profile_compatibility = stream.readUint8();
      this.AVCLevelIndication = stream.readUint8();
      this.lengthSizeMinusOne = stream.readUint8() & 3;
      this.nb_SPS_nalus = stream.readUint8() & 31;
      let toparse = this.size - this.hdr_size - 6;
      this.SPS = new ParameterSetArray();
      for (let i = 0; i < this.nb_SPS_nalus; i++) {
        const length = stream.readUint16();
        this.SPS.push({
          length,
          data: stream.readUint8Array(length)
        });
        toparse -= 2 + length;
      }
      this.nb_PPS_nalus = stream.readUint8();
      toparse--;
      this.PPS = new ParameterSetArray();
      for (let i = 0; i < this.nb_PPS_nalus; i++) {
        const length = stream.readUint16();
        this.PPS.push({
          length,
          data: stream.readUint8Array(length)
        });
        toparse -= 2 + length;
      }
      if (toparse > 0) this.ext = stream.readUint8Array(toparse);
    }
    /** @bundle writing/avcC.js */
    write(stream) {
      this.size = 7;
      for (let i = 0; i < this.SPS.length; i++) this.size += 2 + this.SPS[i].length;
      for (let i = 0; i < this.PPS.length; i++) this.size += 2 + this.PPS[i].length;
      if (this.ext) this.size += this.ext.length;
      this.writeHeader(stream);
      stream.writeUint8(this.configurationVersion);
      stream.writeUint8(this.AVCProfileIndication);
      stream.writeUint8(this.profile_compatibility);
      stream.writeUint8(this.AVCLevelIndication);
      stream.writeUint8(this.lengthSizeMinusOne + 252);
      stream.writeUint8(this.SPS.length + 224);
      for (let i = 0; i < this.SPS.length; i++) {
        stream.writeUint16(this.SPS[i].length);
        stream.writeUint8Array(this.SPS[i].data);
      }
      stream.writeUint8(this.PPS.length);
      for (let i = 0; i < this.PPS.length; i++) {
        stream.writeUint16(this.PPS[i].length);
        stream.writeUint8Array(this.PPS[i].data);
      }
      if (this.ext) stream.writeUint8Array(this.ext);
    }
  }, _a5.fourcc = "avcC", _a5);
  var _a6;
  var mdatBox = (_a6 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "MediaDataBox";
    }
  }, _a6.fourcc = "mdat", _a6);
  var _a7;
  var idatBox = (_a7 = class extends Box {
    constructor(..._args2) {
      super(..._args2);
      this.box_name = "ItemDataBox";
    }
  }, _a7.fourcc = "idat", _a7);
  var _a8;
  var freeBox = (_a8 = class extends Box {
    constructor(..._args3) {
      super(..._args3);
      this.box_name = "FreeSpaceBox";
    }
  }, _a8.fourcc = "free", _a8);
  var _a9;
  var skipBox = (_a9 = class extends Box {
    constructor(..._args4) {
      super(..._args4);
      this.box_name = "FreeSpaceBox";
    }
  }, _a9.fourcc = "skip", _a9);
  var _a10;
  var hmhdBox = (_a10 = class extends FullBox {
    constructor(..._args5) {
      super(..._args5);
      this.box_name = "HintMediaHeaderBox";
    }
  }, _a10.fourcc = "hmhd", _a10);
  var _a11;
  var nmhdBox = (_a11 = class extends FullBox {
    constructor(..._args6) {
      super(..._args6);
      this.box_name = "NullMediaHeaderBox";
    }
  }, _a11.fourcc = "nmhd", _a11);
  var _a12;
  var iodsBox = (_a12 = class extends FullBox {
    constructor(..._args7) {
      super(..._args7);
      this.box_name = "ObjectDescriptorBox";
    }
  }, _a12.fourcc = "iods", _a12);
  var _a13;
  var xmlBox = (_a13 = class extends FullBox {
    constructor(..._args8) {
      super(..._args8);
      this.box_name = "XMLBox";
    }
  }, _a13.fourcc = "xml ", _a13);
  var _a14;
  var bxmlBox = (_a14 = class extends FullBox {
    constructor(..._args9) {
      super(..._args9);
      this.box_name = "BinaryXMLBox";
    }
  }, _a14.fourcc = "bxml", _a14);
  var _a15;
  var iproBox = (_a15 = class extends FullBox {
    constructor(..._args10) {
      super(..._args10);
      this.box_name = "ItemProtectionBox";
      this.sinfs = [];
    }
    get protections() {
      return this.sinfs;
    }
  }, _a15.fourcc = "ipro", _a15);
  var _a16;
  var moovBox = (_a16 = class extends ContainerBox {
    constructor(..._args11) {
      super(..._args11);
      this.box_name = "MovieBox";
      this.traks = [];
      this.psshs = [];
      this.subBoxNames = ["trak", "pssh"];
    }
  }, _a16.fourcc = "moov", _a16);
  var _a17;
  var trakBox = (_a17 = class extends ContainerBox {
    constructor(..._args12) {
      super(..._args12);
      this.box_name = "TrackBox";
      this.samples = [];
    }
  }, _a17.fourcc = "trak", _a17);
  var _a18;
  var edtsBox = (_a18 = class extends ContainerBox {
    constructor(..._args13) {
      super(..._args13);
      this.box_name = "EditBox";
    }
  }, _a18.fourcc = "edts", _a18);
  var _a19;
  var mdiaBox = (_a19 = class extends ContainerBox {
    constructor(..._args14) {
      super(..._args14);
      this.box_name = "MediaBox";
    }
  }, _a19.fourcc = "mdia", _a19);
  var _a20;
  var minfBox = (_a20 = class extends ContainerBox {
    constructor(..._args15) {
      super(..._args15);
      this.box_name = "MediaInformationBox";
    }
  }, _a20.fourcc = "minf", _a20);
  var _a21;
  var dinfBox = (_a21 = class extends ContainerBox {
    constructor(..._args16) {
      super(..._args16);
      this.box_name = "DataInformationBox";
    }
  }, _a21.fourcc = "dinf", _a21);
  var _a22;
  var stblBox = (_a22 = class extends ContainerBox {
    constructor(..._args17) {
      super(..._args17);
      this.box_name = "SampleTableBox";
      this.sgpds = [];
      this.sbgps = [];
      this.subBoxNames = ["sgpd", "sbgp"];
    }
  }, _a22.fourcc = "stbl", _a22);
  var _a23;
  var mvexBox = (_a23 = class extends ContainerBox {
    constructor(..._args18) {
      super(..._args18);
      this.box_name = "MovieExtendsBox";
      this.trexs = [];
      this.subBoxNames = ["trex"];
    }
  }, _a23.fourcc = "mvex", _a23);
  var _a24;
  var moofBox = (_a24 = class extends ContainerBox {
    constructor(..._args19) {
      super(..._args19);
      this.box_name = "MovieFragmentBox";
      this.trafs = [];
      this.subBoxNames = ["traf"];
    }
  }, _a24.fourcc = "moof", _a24);
  var _a25;
  var trafBox = (_a25 = class extends ContainerBox {
    constructor(..._args20) {
      super(..._args20);
      this.box_name = "TrackFragmentBox";
      this.truns = [];
      this.sgpds = [];
      this.sbgps = [];
      this.subBoxNames = [
        "trun",
        "sgpd",
        "sbgp"
      ];
    }
  }, _a25.fourcc = "traf", _a25);
  var _a26;
  var vttcBox = (_a26 = class extends ContainerBox {
    constructor(..._args21) {
      super(..._args21);
      this.box_name = "VTTCueBox";
    }
  }, _a26.fourcc = "vttc", _a26);
  var _a27;
  var mfraBox = (_a27 = class extends ContainerBox {
    constructor(..._args22) {
      super(..._args22);
      this.box_name = "MovieFragmentRandomAccessBox";
      this.tfras = [];
      this.subBoxNames = ["tfra"];
    }
  }, _a27.fourcc = "mfra", _a27);
  var _a28;
  var mecoBox = (_a28 = class extends ContainerBox {
    constructor(..._args23) {
      super(..._args23);
      this.box_name = "AdditionalMetadataContainerBox";
    }
  }, _a28.fourcc = "meco", _a28);
  var _a29;
  var hntiBox = (_a29 = class extends ContainerBox {
    constructor(..._args24) {
      super(..._args24);
      this.box_name = "trackhintinformation";
      this.subBoxNames = ["sdp ", "rtp "];
    }
  }, _a29.fourcc = "hnti", _a29);
  var _a30;
  var hinfBox = (_a30 = class extends ContainerBox {
    constructor(..._args25) {
      super(..._args25);
      this.box_name = "hintstatisticsbox";
      this.maxrs = [];
      this.subBoxNames = ["maxr"];
    }
  }, _a30.fourcc = "hinf", _a30);
  var _a31;
  var strkBox = (_a31 = class extends ContainerBox {
    constructor(..._args26) {
      super(..._args26);
      this.box_name = "SubTrackBox";
    }
  }, _a31.fourcc = "strk", _a31);
  var _a32;
  var strdBox = (_a32 = class extends ContainerBox {
    constructor(..._args27) {
      super(..._args27);
      this.box_name = "SubTrackDefinitionBox";
    }
  }, _a32.fourcc = "strd", _a32);
  var _a33;
  var sinfBox = (_a33 = class extends ContainerBox {
    constructor(..._args28) {
      super(..._args28);
      this.box_name = "ProtectionSchemeInfoBox";
    }
  }, _a33.fourcc = "sinf", _a33);
  var _a34;
  var rinfBox = (_a34 = class extends ContainerBox {
    constructor(..._args29) {
      super(..._args29);
      this.box_name = "RestrictedSchemeInfoBox";
    }
  }, _a34.fourcc = "rinf", _a34);
  var _a35;
  var schiBox = (_a35 = class extends ContainerBox {
    constructor(..._args30) {
      super(..._args30);
      this.box_name = "SchemeInformationBox";
    }
  }, _a35.fourcc = "schi", _a35);
  var _a36;
  var trgrBox = (_a36 = class extends ContainerBox {
    constructor(..._args31) {
      super(..._args31);
      this.box_name = "TrackGroupBox";
    }
  }, _a36.fourcc = "trgr", _a36);
  var _a37;
  var udtaBox = (_a37 = class extends ContainerBox {
    constructor(..._args32) {
      super(..._args32);
      this.box_name = "UserDataBox";
      this.kinds = [];
      this.strks = [];
      this.subBoxNames = ["kind", "strk"];
    }
  }, _a37.fourcc = "udta", _a37);
  var _a38;
  var iprpBox = (_a38 = class extends ContainerBox {
    constructor(..._args33) {
      super(..._args33);
      this.box_name = "ItemPropertiesBox";
      this.ipmas = [];
      this.subBoxNames = ["ipma"];
    }
  }, _a38.fourcc = "iprp", _a38);
  var _a39;
  var ipcoBox = (_a39 = class extends ContainerBox {
    constructor(..._args34) {
      super(..._args34);
      this.box_name = "ItemPropertyContainerBox";
      this.hvcCs = [];
      this.ispes = [];
      this.claps = [];
      this.irots = [];
      this.subBoxNames = [
        "hvcC",
        "ispe",
        "clap",
        "irot"
      ];
    }
  }, _a39.fourcc = "ipco", _a39);
  var _a40;
  var grplBox = (_a40 = class extends ContainerBox {
    constructor(..._args35) {
      super(..._args35);
      this.box_name = "GroupsListBox";
    }
  }, _a40.fourcc = "grpl", _a40);
  var _a41;
  var j2kHBox = (_a41 = class extends ContainerBox {
    constructor(..._args36) {
      super(..._args36);
      this.box_name = "J2KHeaderInfoBox";
    }
  }, _a41.fourcc = "j2kH", _a41);
  var _a42;
  var etypBox = (_a42 = class extends ContainerBox {
    constructor(..._args37) {
      super(..._args37);
      this.box_name = "ExtendedTypeBox";
      this.tycos = [];
      this.subBoxNames = ["tyco"];
    }
  }, _a42.fourcc = "etyp", _a42);
  var _a43;
  var povdBox = (_a43 = class extends ContainerBox {
    constructor(..._args38) {
      super(..._args38);
      this.box_name = "ProjectedOmniVideoBox";
      this.subBoxNames = ["prfr"];
    }
  }, _a43.fourcc = "povd", _a43);
  var _a44;
  var drefBox = (_a44 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "DataReferenceBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.entries = [];
      const entry_count = stream.readUint32();
      for (let i = 0; i < entry_count; i++) {
        const ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret.code === 1) {
          const box2 = ret.box;
          this.entries.push(box2);
        } else return;
      }
    }
    /** @bundle writing/dref.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4;
      this.writeHeader(stream);
      stream.writeUint32(this.entries.length);
      for (let i = 0; i < this.entries.length; i++) {
        this.entries[i].write(stream);
        this.size += this.entries[i].size;
      }
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    }
  }, _a44.fourcc = "dref", _a44);
  var _a45;
  var elngBox = (_a45 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ExtendedLanguageBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.extended_language = stream.readString(this.size - this.hdr_size);
    }
    /** @bundle writing/elng.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = this.extended_language.length;
      this.writeHeader(stream);
      stream.writeString(this.extended_language);
    }
  }, _a45.fourcc = "elng", _a45);
  var _a46;
  var ftypBox = (_a46 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "FileTypeBox";
    }
    parse(stream) {
      let toparse = this.size - this.hdr_size;
      this.major_brand = stream.readString(4);
      this.minor_version = stream.readUint32();
      const minor_version_str = String.fromCharCode(this.minor_version >> 24, this.minor_version >> 16 & 255, this.minor_version >> 8 & 255, this.minor_version & 255);
      if (minor_version_str.match("[a-zA-Z0-9]{4}")) this.minor_version = minor_version_str;
      toparse -= 8;
      this.compatible_brands = [];
      let i = 0;
      while (toparse >= 4) {
        this.compatible_brands[i] = stream.readString(4);
        toparse -= 4;
        i++;
      }
    }
    /** @bundle writing/ftyp.js */
    write(stream) {
      this.size = 8 + 4 * this.compatible_brands.length;
      this.writeHeader(stream);
      stream.writeString(this.major_brand, void 0, 4);
      if (typeof this.minor_version === "number") stream.writeUint32(this.minor_version);
      else stream.writeString(this.minor_version, void 0, 4);
      for (let i = 0; i < this.compatible_brands.length; i++) stream.writeString(this.compatible_brands[i], void 0, 4);
    }
  }, _a46.fourcc = "ftyp", _a46);
  var _a47;
  var hdlrBox = (_a47 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "HandlerBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 0) {
        stream.readUint32();
        this.handler = stream.readString(4);
        stream.readUint32Array(3);
        if (!this.isEndOfBox(stream)) {
          const name_size = this.start + this.size - stream.getPosition();
          this.name = stream.readCString();
          const end = this.start + this.size - 1;
          stream.seek(end);
          if (stream.readUint8() !== 0 && name_size > 1) {
            Log.info("BoxParser", "Warning: hdlr name is not null-terminated, possibly length-prefixed string. Trimming first byte.");
            this.name = this.name.slice(1);
          }
        }
      }
    }
    /** @bundle writing/hldr.js */
    write(stream) {
      this.size = 20 + this.name.length + 1;
      this.version = 0;
      this.flags = 0;
      this.writeHeader(stream);
      stream.writeUint32(0);
      stream.writeString(this.handler, void 0, 4);
      stream.writeUint32Array([
        0,
        0,
        0
      ]);
      stream.writeCString(this.name);
    }
  }, _a47.fourcc = "hdlr", _a47);
  var _a48;
  var hvcCBox = (_a48 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "HEVCConfigurationBox";
    }
    parse(stream) {
      this.configurationVersion = stream.readUint8();
      let tmp_byte = stream.readUint8();
      this.general_profile_space = tmp_byte >> 6;
      this.general_tier_flag = (tmp_byte & 32) >> 5;
      this.general_profile_idc = tmp_byte & 31;
      this.general_profile_compatibility = stream.readUint32();
      this.general_constraint_indicator = stream.readUint8Array(6);
      this.general_level_idc = stream.readUint8();
      this.min_spatial_segmentation_idc = stream.readUint16() & 4095;
      this.parallelismType = stream.readUint8() & 3;
      this.chroma_format_idc = stream.readUint8() & 3;
      this.bit_depth_luma_minus8 = stream.readUint8() & 7;
      this.bit_depth_chroma_minus8 = stream.readUint8() & 7;
      this.avgFrameRate = stream.readUint16();
      tmp_byte = stream.readUint8();
      this.constantFrameRate = tmp_byte >> 6;
      this.numTemporalLayers = (tmp_byte & 13) >> 3;
      this.temporalIdNested = (tmp_byte & 4) >> 2;
      this.lengthSizeMinusOne = tmp_byte & 3;
      this.nalu_arrays = [];
      const numOfArrays = stream.readUint8();
      for (let i = 0; i < numOfArrays; i++) {
        const nalu_array = [];
        this.nalu_arrays.push(nalu_array);
        tmp_byte = stream.readUint8();
        nalu_array.completeness = (tmp_byte & 128) >> 7;
        nalu_array.nalu_type = tmp_byte & 63;
        const numNalus = stream.readUint16();
        for (let j = 0; j < numNalus; j++) {
          const length = stream.readUint16();
          nalu_array.push({ data: stream.readUint8Array(length) });
        }
      }
    }
    /** @bundle writing/write.js */
    write(stream) {
      this.size = 23;
      for (let i = 0; i < this.nalu_arrays.length; i++) {
        this.size += 3;
        for (let j = 0; j < this.nalu_arrays[i].length; j++) this.size += 2 + this.nalu_arrays[i][j].data.length;
      }
      this.writeHeader(stream);
      stream.writeUint8(this.configurationVersion);
      stream.writeUint8((this.general_profile_space << 6) + (this.general_tier_flag << 5) + this.general_profile_idc);
      stream.writeUint32(this.general_profile_compatibility);
      stream.writeUint8Array(this.general_constraint_indicator);
      stream.writeUint8(this.general_level_idc);
      stream.writeUint16(this.min_spatial_segmentation_idc + (15 << 24));
      stream.writeUint8(this.parallelismType + 252);
      stream.writeUint8(this.chroma_format_idc + 252);
      stream.writeUint8(this.bit_depth_luma_minus8 + 248);
      stream.writeUint8(this.bit_depth_chroma_minus8 + 248);
      stream.writeUint16(this.avgFrameRate);
      stream.writeUint8((this.constantFrameRate << 6) + (this.numTemporalLayers << 3) + (this.temporalIdNested << 2) + this.lengthSizeMinusOne);
      stream.writeUint8(this.nalu_arrays.length);
      for (let i = 0; i < this.nalu_arrays.length; i++) {
        stream.writeUint8((this.nalu_arrays[i].completeness << 7) + this.nalu_arrays[i].nalu_type);
        stream.writeUint16(this.nalu_arrays[i].length);
        for (let j = 0; j < this.nalu_arrays[i].length; j++) {
          stream.writeUint16(this.nalu_arrays[i][j].data.length);
          stream.writeUint8Array(this.nalu_arrays[i][j].data);
        }
      }
    }
  }, _a48.fourcc = "hvcC", _a48);
  var _a49;
  var mdhdBox = (_a49 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "MediaHeaderBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 1) {
        this.creation_time = stream.readUint64();
        this.modification_time = stream.readUint64();
        this.timescale = stream.readUint32();
        this.duration = stream.readUint64();
      } else {
        this.creation_time = stream.readUint32();
        this.modification_time = stream.readUint32();
        this.timescale = stream.readUint32();
        this.duration = stream.readUint32();
      }
      this.parseLanguage(stream);
      stream.readUint16();
    }
    /** @bundle writing/mdhd.js */
    write(stream) {
      const useVersion1 = this.modification_time > MAX_UINT32 || this.creation_time > MAX_UINT32 || this.duration > MAX_UINT32 || this.version === 1;
      this.version = useVersion1 ? 1 : 0;
      this.size = 20;
      this.size += useVersion1 ? 12 : 0;
      this.flags = 0;
      this.writeHeader(stream);
      if (useVersion1) {
        stream.writeUint64(this.creation_time);
        stream.writeUint64(this.modification_time);
        stream.writeUint32(this.timescale);
        stream.writeUint64(this.duration);
      } else {
        stream.writeUint32(this.creation_time);
        stream.writeUint32(this.modification_time);
        stream.writeUint32(this.timescale);
        stream.writeUint32(this.duration);
      }
      stream.writeUint16(this.language);
      stream.writeUint16(0);
    }
  }, _a49.fourcc = "mdhd", _a49);
  var _a50;
  var mehdBox = (_a50 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "MovieExtendsHeaderBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.flags & 1) {
        Log.warn("BoxParser", "mehd box incorrectly uses flags set to 1, converting version to 1");
        this.version = 1;
      }
      if (this.version === 1) this.fragment_duration = stream.readUint64();
      else this.fragment_duration = stream.readUint32();
    }
    /** @bundle writing/mehd.js */
    write(stream) {
      const useVersion1 = this.fragment_duration > MAX_UINT32 || this.version === 1;
      this.version = useVersion1 ? 1 : 0;
      this.size = 4;
      this.size += useVersion1 ? 4 : 0;
      this.flags = 0;
      this.writeHeader(stream);
      if (useVersion1) stream.writeUint64(this.fragment_duration);
      else stream.writeUint32(this.fragment_duration);
    }
  }, _a50.fourcc = "mehd", _a50);
  var _a51;
  var infeBox = (_a51 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ItemInfoEntry";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 0 || this.version === 1) {
        this.item_ID = stream.readUint16();
        this.item_protection_index = stream.readUint16();
        this.item_name = stream.readCString();
        this.content_type = stream.readCString();
        if (!this.isEndOfBox(stream)) this.content_encoding = stream.readCString();
      }
      if (this.version === 1) {
        this.extension_type = stream.readString(4);
        Log.warn("BoxParser", "Cannot parse extension type");
        stream.seek(this.start + this.size);
        return;
      }
      if (this.version >= 2) {
        if (this.version === 2) this.item_ID = stream.readUint16();
        else if (this.version === 3) this.item_ID = stream.readUint32();
        this.item_protection_index = stream.readUint16();
        this.item_type = stream.readString(4);
        this.item_name = stream.readCString();
        if (this.item_type === "mime") {
          this.content_type = stream.readCString();
          this.content_encoding = stream.readCString();
        } else if (this.item_type === "uri ") this.item_uri_type = stream.readCString();
      }
    }
  }, _a51.fourcc = "infe", _a51);
  var _a52;
  var iinfBox = (_a52 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ItemInfoBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 0) this.entry_count = stream.readUint16();
      else this.entry_count = stream.readUint32();
      this.item_infos = [];
      for (let i = 0; i < this.entry_count; i++) {
        const ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret.code === 1) {
          const box2 = ret.box;
          if (box2.type === "infe") this.item_infos[i] = box2;
          else Log.error("BoxParser", "Expected 'infe' box, got " + ret.box.type, stream.isofile);
        } else return;
      }
    }
  }, _a52.fourcc = "iinf", _a52);
  var _a53;
  var ilocBox = (_a53 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ItemLocationBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      let byte;
      byte = stream.readUint8();
      this.offset_size = byte >> 4 & 15;
      this.length_size = byte & 15;
      byte = stream.readUint8();
      this.base_offset_size = byte >> 4 & 15;
      if (this.version === 1 || this.version === 2) this.index_size = byte & 15;
      else this.index_size = 0;
      this.items = [];
      let item_count = 0;
      if (this.version < 2) item_count = stream.readUint16();
      else if (this.version === 2) item_count = stream.readUint32();
      else throw new Error("version of iloc box not supported");
      for (let i = 0; i < item_count; i++) {
        let item_ID = 0;
        let construction_method = 0;
        let base_offset = 0;
        if (this.version < 2) item_ID = stream.readUint16();
        else if (this.version === 2) item_ID = stream.readUint32();
        else throw new Error("version of iloc box not supported");
        if (this.version === 1 || this.version === 2) construction_method = stream.readUint16() & 15;
        else construction_method = 0;
        const data_reference_index = stream.readUint16();
        switch (this.base_offset_size) {
          case 0:
            base_offset = 0;
            break;
          case 4:
            base_offset = stream.readUint32();
            break;
          case 8:
            base_offset = stream.readUint64();
            break;
          default:
            throw new Error("Error reading base offset size");
        }
        const extents = [];
        const extent_count = stream.readUint16();
        for (let j = 0; j < extent_count; j++) {
          let extent_index = 0;
          let extent_offset = 0;
          let extent_length = 0;
          if (this.version === 1 || this.version === 2) switch (this.index_size) {
            case 0:
              extent_index = 0;
              break;
            case 4:
              extent_index = stream.readUint32();
              break;
            case 8:
              extent_index = stream.readUint64();
              break;
            default:
              throw new Error("Error reading extent index");
          }
          switch (this.offset_size) {
            case 0:
              extent_offset = 0;
              break;
            case 4:
              extent_offset = stream.readUint32();
              break;
            case 8:
              extent_offset = stream.readUint64();
              break;
            default:
              throw new Error("Error reading extent index");
          }
          switch (this.length_size) {
            case 0:
              extent_length = 0;
              break;
            case 4:
              extent_length = stream.readUint32();
              break;
            case 8:
              extent_length = stream.readUint64();
              break;
            default:
              throw new Error("Error reading extent index");
          }
          extents.push({
            extent_index,
            extent_length,
            extent_offset
          });
        }
        this.items.push({
          base_offset,
          construction_method,
          item_ID,
          data_reference_index,
          extents
        });
      }
    }
  }, _a53.fourcc = "iloc", _a53);
  var REFERENCE_TYPE_NAMES = {
    auxl: "Auxiliary image item",
    base: "Pre-derived image item base",
    cdsc: "Item describes referenced item",
    dimg: "Derived image item",
    dpnd: "Item coding dependency",
    eroi: "Region",
    evir: "EVC slice",
    exbl: "Scalable image item",
    "fdl ": "File delivery",
    font: "Font item",
    iloc: "Item data location",
    mask: "Region mask",
    mint: "Data integrity",
    pred: "Predictively coded item",
    prem: "Pre-multiplied item",
    tbas: "HEVC tile track base item",
    text: "Text item",
    thmb: "Thumbnail image item"
  };
  var _a54;
  var irefBox = (_a54 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ItemReferenceBox";
      this.references = [];
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.references = [];
      while (stream.getPosition() < this.start + this.size) {
        const ret = parseOneBox(stream, true, this.size - (stream.getPosition() - this.start));
        if (ret.code === 1) {
          let name = "Unknown item reference";
          if (!_a54.allowed_types.includes(ret.type)) Log.warn("BoxParser", `Unknown item reference type: '${ret.type}'`);
          else name = REFERENCE_TYPE_NAMES[ret.type];
          const box2 = this.version === 0 ? new SingleItemTypeReferenceBox(ret.type, ret.size, name, ret.hdr_size, ret.start) : new SingleItemTypeReferenceBoxLarge(ret.type, ret.size, name, ret.hdr_size, ret.start);
          if (box2.write === Box.prototype.write && box2.type !== "mdat") {
            Log.warn("BoxParser", box2.type + " box writing not yet implemented, keeping unparsed data in memory for later write");
            box2.parseDataAndRewind(stream);
          }
          box2.parse(stream);
          this.references.push(box2);
        } else return;
      }
    }
  }, _a54.fourcc = "iref", _a54.allowed_types = [
    "auxl",
    "base",
    "cdsc",
    "dimg",
    "dpnd",
    "eroi",
    "evir",
    "exbl",
    "fdl ",
    "font",
    "iloc",
    "mask",
    "mint",
    "pred",
    "prem",
    "tbas",
    "text",
    "thmb"
  ], _a54);
  var _a55;
  var pitmBox = (_a55 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "PrimaryItemBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 0) this.item_id = stream.readUint16();
      else this.item_id = stream.readUint32();
    }
  }, _a55.fourcc = "pitm", _a55);
  var _a56;
  var metaBox = (_a56 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "MetaBox";
      this.isQT = false;
    }
    parse(stream) {
      const pos = stream.getPosition();
      if (this.size > 8) {
        stream.readUint32();
        switch (stream.readString(4)) {
          case "hdlr":
          case "mhdr":
          case "keys":
          case "ilst":
          case "ctry":
          case "lang":
            this.isQT = true;
            break;
          default:
            break;
        }
        stream.seek(pos);
      }
      if (!this.isQT) this.parseFullHeader(stream);
      ContainerBox.prototype.parse.call(this, stream);
    }
  }, _a56.fourcc = "meta", _a56);
  var _a57;
  var mfhdBox = (_a57 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "MovieFragmentHeaderBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.sequence_number = stream.readUint32();
    }
    /** @bundle writing/mfhd.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4;
      this.writeHeader(stream);
      stream.writeUint32(this.sequence_number);
    }
  }, _a57.fourcc = "mfhd", _a57);
  var _a58;
  var mvhdBox = (_a58 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "MovieHeaderBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 1) {
        this.creation_time = stream.readUint64();
        this.modification_time = stream.readUint64();
        this.timescale = stream.readUint32();
        this.duration = stream.readUint64();
      } else {
        this.creation_time = stream.readUint32();
        this.modification_time = stream.readUint32();
        this.timescale = stream.readUint32();
        this.duration = stream.readUint32();
      }
      this.rate = stream.readUint32();
      this.volume = stream.readUint16() >> 8;
      stream.readUint16();
      stream.readUint32Array(2);
      this.matrix = stream.readInt32Array(9);
      stream.readUint32Array(6);
      this.next_track_id = stream.readUint32();
    }
    /** @bundle writing/mvhd.js */
    write(stream) {
      const useVersion1 = this.modification_time > MAX_UINT32 || this.creation_time > MAX_UINT32 || this.duration > MAX_UINT32 || this.version === 1;
      this.version = useVersion1 ? 1 : 0;
      this.size = 96;
      this.size += useVersion1 ? 12 : 0;
      this.flags = 0;
      this.writeHeader(stream);
      if (useVersion1) {
        stream.writeUint64(this.creation_time);
        stream.writeUint64(this.modification_time);
        stream.writeUint32(this.timescale);
        stream.writeUint64(this.duration);
      } else {
        stream.writeUint32(this.creation_time);
        stream.writeUint32(this.modification_time);
        stream.writeUint32(this.timescale);
        stream.writeUint32(this.duration);
      }
      stream.writeUint32(this.rate);
      stream.writeUint16(this.volume << 8);
      stream.writeUint16(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeInt32Array(this.matrix);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(this.next_track_id);
    }
    /** @bundle box-print.js */
    print(output) {
      super.printHeader(output);
      output.log(output.indent + "creation_time: " + this.creation_time);
      output.log(output.indent + "modification_time: " + this.modification_time);
      output.log(output.indent + "timescale: " + this.timescale);
      output.log(output.indent + "duration: " + this.duration);
      output.log(output.indent + "rate: " + this.rate);
      output.log(output.indent + "volume: " + (this.volume >> 8));
      output.log(output.indent + "matrix: " + this.matrix.join(", "));
      output.log(output.indent + "next_track_id: " + this.next_track_id);
    }
  }, _a58.fourcc = "mvhd", _a58);
  var _a59;
  var mettSampleEntry = (_a59 = class extends MetadataSampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      this.content_encoding = stream.readCString();
      this.mime_format = stream.readCString();
      this.parseFooter(stream);
    }
  }, _a59.fourcc = "mett", _a59);
  var _a60;
  var metxSampleEntry = (_a60 = class extends MetadataSampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      this.content_encoding = stream.readCString();
      this.namespace = stream.readCString();
      this.schema_location = stream.readCString();
      this.parseFooter(stream);
    }
  }, _a60.fourcc = "metx", _a60);
  var _a61;
  var av1CBox = (_a61 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "AV1CodecConfigurationBox";
    }
    parse(stream) {
      let tmp = stream.readUint8();
      if ((tmp >> 7 & 1) !== 1) {
        Log.error("BoxParser", "av1C marker problem", stream.isofile);
        return;
      }
      this.version = tmp & 127;
      if (this.version !== 1) {
        Log.error("BoxParser", "av1C version " + this.version + " not supported", stream.isofile);
        return;
      }
      tmp = stream.readUint8();
      this.seq_profile = tmp >> 5 & 7;
      this.seq_level_idx_0 = tmp & 31;
      tmp = stream.readUint8();
      this.seq_tier_0 = tmp >> 7 & 1;
      this.high_bitdepth = tmp >> 6 & 1;
      this.twelve_bit = tmp >> 5 & 1;
      this.monochrome = tmp >> 4 & 1;
      this.chroma_subsampling_x = tmp >> 3 & 1;
      this.chroma_subsampling_y = tmp >> 2 & 1;
      this.chroma_sample_position = tmp & 3;
      tmp = stream.readUint8();
      this.reserved_1 = tmp >> 5 & 7;
      if (this.reserved_1 !== 0) {
        Log.error("BoxParser", "av1C reserved_1 parsing problem", stream.isofile);
        return;
      }
      this.initial_presentation_delay_present = tmp >> 4 & 1;
      if (this.initial_presentation_delay_present === 1) this.initial_presentation_delay_minus_one = tmp & 15;
      else {
        this.reserved_2 = tmp & 15;
        if (this.reserved_2 !== 0) {
          Log.error("BoxParser", "av1C reserved_2 parsing problem", stream.isofile);
          return;
        }
      }
      const configOBUs_length = this.size - this.hdr_size - 4;
      this.configOBUs = stream.readUint8Array(configOBUs_length);
    }
  }, _a61.fourcc = "av1C", _a61);
  var _a62;
  var esdsBox = (_a62 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ElementaryStreamDescriptorBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const esd_data = stream.readUint8Array(this.size - this.hdr_size);
      if ("MPEG4DescriptorParser" in DescriptorRegistry) {
        const esd_parser = new DescriptorRegistry.MPEG4DescriptorParser();
        this.esd = esd_parser.parseOneDescriptor(new DataStream(esd_data.buffer, 0));
      }
    }
  }, _a62.fourcc = "esds", _a62);
  var _a63;
  var waveBox = (_a63 = class extends ContainerBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "siDecompressionParamBox";
    }
  }, _a63.fourcc = "wave", _a63);
  var _a64;
  var lvcCBox = (_a64 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "LCEVCConfigurationBox";
    }
    parse(stream) {
      this.configurationVersion = stream.readUint8();
      if (this.configurationVersion !== 1) {
        Log.error("BoxParser", "lvcC version " + this.configurationVersion + " not supported", stream.isofile);
        return;
      }
      this.LCEVCProfileIndication = stream.readUint8();
      this.LCEVCLevelIndication = stream.readUint8();
      let tmp_byte = stream.readUint8();
      this.chroma_format_idc = tmp_byte >> 6 & 3;
      this.bit_depth_luma_minus8 = tmp_byte >> 3 & 7;
      this.bit_depth_chroma_minus8 = tmp_byte & 7;
      tmp_byte = stream.readUint8();
      this.lengthSizeMinusOne = tmp_byte >> 6 & 3;
      let reserved = tmp_byte & 63;
      if (reserved !== 63) {
        Log.error("BoxParser", "lvcC reserved parsing problem", stream.isofile);
        return;
      }
      this.pic_width_in_luma_samples = stream.readUint32();
      this.pic_height_in_luma_samples = stream.readUint32();
      tmp_byte = stream.readUint8();
      this.sc_in_stream = tmp_byte >> 7 & 1;
      this.gc_in_stream = tmp_byte >> 6 & 1;
      this.ai_in_stream = tmp_byte >> 5 & 1;
      reserved = tmp_byte & 31;
      if (reserved !== 31) {
        Log.error("BoxParser", "lvcC reserved parsing problem", stream.isofile);
        return;
      }
      this.nalu_arrays = [];
      const numOfArrays = stream.readUint8();
      for (let i = 0; i < numOfArrays; i++) {
        const nalu_array = [];
        this.nalu_arrays.push(nalu_array);
        tmp_byte = stream.readUint8();
        reserved = tmp_byte >> 6 & 3;
        if (reserved !== 0) {
          Log.error("BoxParser", "lvcC reserved parsing problem", stream.isofile);
          return;
        }
        nalu_array.nalu_type = tmp_byte & 63;
        const numOfNalus = stream.readUint16();
        for (let j = 0; j < numOfNalus; j++) {
          const length = stream.readUint16();
          nalu_array.push({ data: stream.readUint8Array(length) });
        }
      }
    }
  }, _a64.fourcc = "lvcC", _a64);
  var _a65;
  var vpcCBox = (_a65 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "VPCodecConfigurationRecord";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 1) {
        this.profile = stream.readUint8();
        this.level = stream.readUint8();
        const tmp = stream.readUint8();
        this.bitDepth = tmp >> 4;
        this.chromaSubsampling = tmp >> 1 & 7;
        this.videoFullRangeFlag = tmp & 1;
        this.colourPrimaries = stream.readUint8();
        this.transferCharacteristics = stream.readUint8();
        this.matrixCoefficients = stream.readUint8();
        this.codecIntializationDataSize = stream.readUint16();
        this.codecIntializationData = stream.readUint8Array(this.codecIntializationDataSize);
      } else {
        this.profile = stream.readUint8();
        this.level = stream.readUint8();
        let tmp = stream.readUint8();
        this.bitDepth = tmp >> 4 & 15;
        this.colorSpace = tmp & 15;
        tmp = stream.readUint8();
        this.chromaSubsampling = tmp >> 4 & 15;
        this.transferFunction = tmp >> 1 & 7;
        this.videoFullRangeFlag = tmp & 1;
        this.codecIntializationDataSize = stream.readUint16();
        this.codecIntializationData = stream.readUint8Array(this.codecIntializationDataSize);
      }
    }
  }, _a65.fourcc = "vpcC", _a65);
  var _a66;
  var vvcCBox = (_a66 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "VvcConfigurationBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const bitReader = {
        held_bits: void 0,
        num_held_bits: 0,
        stream_read_1_bytes: function(strm) {
          this.held_bits = strm.readUint8();
          this.num_held_bits = 8;
        },
        stream_read_2_bytes: function(strm) {
          this.held_bits = strm.readUint16();
          this.num_held_bits = 16;
        },
        extract_bits: function(num_bits) {
          const ret = this.held_bits >> this.num_held_bits - num_bits & (1 << num_bits) - 1;
          this.num_held_bits -= num_bits;
          return ret;
        }
      };
      bitReader.stream_read_1_bytes(stream);
      bitReader.extract_bits(5);
      this.lengthSizeMinusOne = bitReader.extract_bits(2);
      this.ptl_present_flag = bitReader.extract_bits(1);
      if (this.ptl_present_flag) {
        bitReader.stream_read_2_bytes(stream);
        this.ols_idx = bitReader.extract_bits(9);
        this.num_sublayers = bitReader.extract_bits(3);
        this.constant_frame_rate = bitReader.extract_bits(2);
        this.chroma_format_idc = bitReader.extract_bits(2);
        bitReader.stream_read_1_bytes(stream);
        this.bit_depth_minus8 = bitReader.extract_bits(3);
        bitReader.extract_bits(5);
        bitReader.stream_read_2_bytes(stream);
        bitReader.extract_bits(2);
        this.num_bytes_constraint_info = bitReader.extract_bits(6);
        this.general_profile_idc = bitReader.extract_bits(7);
        this.general_tier_flag = bitReader.extract_bits(1);
        this.general_level_idc = stream.readUint8();
        bitReader.stream_read_1_bytes(stream);
        this.ptl_frame_only_constraint_flag = bitReader.extract_bits(1);
        this.ptl_multilayer_enabled_flag = bitReader.extract_bits(1);
        this.general_constraint_info = new Uint8Array(this.num_bytes_constraint_info);
        if (this.num_bytes_constraint_info) {
          for (let i = 0; i < this.num_bytes_constraint_info - 1; i++) {
            const cnstr1 = bitReader.extract_bits(6);
            bitReader.stream_read_1_bytes(stream);
            const cnstr2 = bitReader.extract_bits(2);
            this.general_constraint_info[i] = cnstr1 << 2 | cnstr2;
          }
          this.general_constraint_info[this.num_bytes_constraint_info - 1] = bitReader.extract_bits(6);
        } else bitReader.extract_bits(6);
        if (this.num_sublayers > 1) {
          bitReader.stream_read_1_bytes(stream);
          this.ptl_sublayer_present_mask = 0;
          for (let j = this.num_sublayers - 2; j >= 0; --j) {
            const val = bitReader.extract_bits(1);
            this.ptl_sublayer_present_mask |= val << j;
          }
          for (let j = this.num_sublayers; j <= 8 && this.num_sublayers > 1; ++j) bitReader.extract_bits(1);
          this.sublayer_level_idc = [];
          for (let j = this.num_sublayers - 2; j >= 0; --j) if (this.ptl_sublayer_present_mask & 1 << j) this.sublayer_level_idc[j] = stream.readUint8();
        }
        this.ptl_num_sub_profiles = stream.readUint8();
        this.general_sub_profile_idc = [];
        if (this.ptl_num_sub_profiles) for (let i = 0; i < this.ptl_num_sub_profiles; i++) this.general_sub_profile_idc.push(stream.readUint32());
        this.max_picture_width = stream.readUint16();
        this.max_picture_height = stream.readUint16();
        this.avg_frame_rate = stream.readUint16();
      }
      const VVC_NALU_OPI = 12;
      const VVC_NALU_DEC_PARAM = 13;
      this.nalu_arrays = [];
      const num_of_arrays = stream.readUint8();
      for (let i = 0; i < num_of_arrays; i++) {
        const nalu_array = [];
        this.nalu_arrays.push(nalu_array);
        bitReader.stream_read_1_bytes(stream);
        nalu_array.completeness = bitReader.extract_bits(1);
        bitReader.extract_bits(2);
        nalu_array.nalu_type = bitReader.extract_bits(5);
        let numNalus = 1;
        if (nalu_array.nalu_type !== VVC_NALU_DEC_PARAM && nalu_array.nalu_type !== VVC_NALU_OPI) numNalus = stream.readUint16();
        for (let j = 0; j < numNalus; j++) {
          const len = stream.readUint16();
          nalu_array.push({
            data: stream.readUint8Array(len),
            length: len
          });
        }
      }
    }
  }, _a66.fourcc = "vvcC", _a66);
  var _a67;
  var colrBox = (_a67 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ColourInformationBox";
    }
    parse(stream) {
      this.colour_type = stream.readString(4);
      if (this.colour_type === "nclx") {
        this.colour_primaries = stream.readUint16();
        this.transfer_characteristics = stream.readUint16();
        this.matrix_coefficients = stream.readUint16();
        const tmp = stream.readUint8();
        this.full_range_flag = tmp >> 7;
      } else if (this.colour_type === "rICC") this.ICC_profile = stream.readUint8Array(this.size - 4);
      else if (this.colour_type === "prof") this.ICC_profile = stream.readUint8Array(this.size - 4);
    }
  }, _a67.fourcc = "colr", _a67);
  function decimalToHex(d, padding) {
    let hex = Number(d).toString(16);
    padding = typeof padding === "undefined" ? 2 : padding;
    while (hex.length < padding) hex = "0" + hex;
    return hex;
  }
  var avcCSampleEntryBase = class extends VisualSampleEntry {
    /** @bundle box-codecs.js */
    getCodec() {
      const baseCodec = super.getCodec();
      if (this.avcC) return `${baseCodec}.${decimalToHex(this.avcC.AVCProfileIndication)}${decimalToHex(this.avcC.profile_compatibility)}${decimalToHex(this.avcC.AVCLevelIndication)}`;
      else return baseCodec;
    }
  };
  var _a68;
  var avc1SampleEntry = (_a68 = class extends avcCSampleEntryBase {
    constructor(..._args) {
      super(..._args);
      this.box_name = "AVCSampleEntry";
    }
  }, _a68.fourcc = "avc1", _a68);
  var _a69;
  var avc2SampleEntry = (_a69 = class extends avcCSampleEntryBase {
    constructor(..._args2) {
      super(..._args2);
      this.box_name = "AVC2SampleEntry";
    }
  }, _a69.fourcc = "avc2", _a69);
  var _a70;
  var avc3SampleEntry = (_a70 = class extends avcCSampleEntryBase {
    constructor(..._args3) {
      super(..._args3);
      this.box_name = "AVCSampleEntry";
    }
  }, _a70.fourcc = "avc3", _a70);
  var _a71;
  var avc4SampleEntry = (_a71 = class extends avcCSampleEntryBase {
    constructor(..._args4) {
      super(..._args4);
      this.box_name = "AVC2SampleEntry";
    }
  }, _a71.fourcc = "avc4", _a71);
  var _a72;
  var av01SampleEntry = (_a72 = class extends VisualSampleEntry {
    constructor(..._args5) {
      super(..._args5);
      this.box_name = "AV1SampleEntry";
    }
    /** @bundle box-codecs.js */
    getCodec() {
      const baseCodec = super.getCodec();
      const level_idx_0 = this.av1C.seq_level_idx_0;
      const level = level_idx_0 < 10 ? "0" + level_idx_0 : level_idx_0;
      let bitdepth;
      if (this.av1C.seq_profile === 2 && this.av1C.high_bitdepth === 1) bitdepth = this.av1C.twelve_bit === 1 ? "12" : "10";
      else if (this.av1C.seq_profile <= 2) bitdepth = this.av1C.high_bitdepth === 1 ? "10" : "08";
      return baseCodec + "." + this.av1C.seq_profile + "." + level + (this.av1C.seq_tier_0 ? "H" : "M") + "." + bitdepth;
    }
  }, _a72.fourcc = "av01", _a72);
  var _a73;
  var dav1SampleEntry = (_a73 = class extends VisualSampleEntry {
  }, _a73.fourcc = "dav1", _a73);
  var hvcCSampleEntryBase = class extends VisualSampleEntry {
    /** @bundle box-codecs.js */
    getCodec() {
      let baseCodec = super.getCodec();
      if (this.hvcC) {
        baseCodec += ".";
        switch (this.hvcC.general_profile_space) {
          case 0:
            baseCodec += "";
            break;
          case 1:
            baseCodec += "A";
            break;
          case 2:
            baseCodec += "B";
            break;
          case 3:
            baseCodec += "C";
            break;
        }
        baseCodec += this.hvcC.general_profile_idc;
        baseCodec += ".";
        let val = this.hvcC.general_profile_compatibility;
        let reversed = 0;
        for (let i = 0; i < 32; i++) {
          reversed |= val & 1;
          if (i === 31) break;
          reversed <<= 1;
          val >>= 1;
        }
        baseCodec += decimalToHex(reversed, 0);
        baseCodec += ".";
        if (this.hvcC.general_tier_flag === 0) baseCodec += "L";
        else baseCodec += "H";
        baseCodec += this.hvcC.general_level_idc;
        let hasByte = false;
        let constraint_string = "";
        for (let i = 5; i >= 0; i--) if (this.hvcC.general_constraint_indicator[i] || hasByte) {
          constraint_string = "." + decimalToHex(this.hvcC.general_constraint_indicator[i], 0) + constraint_string;
          hasByte = true;
        }
        baseCodec += constraint_string;
      }
      return baseCodec;
    }
  };
  var _a74;
  var hvc1SampleEntry = (_a74 = class extends hvcCSampleEntryBase {
    constructor(..._args6) {
      super(..._args6);
      this.box_name = "HEVCSampleEntry";
    }
  }, _a74.fourcc = "hvc1", _a74);
  var _a75;
  var hvc2SampleEntry = (_a75 = class extends hvcCSampleEntryBase {
  }, _a75.fourcc = "hvc2", _a75);
  var _a76;
  var hev1SampleEntry = (_a76 = class extends hvcCSampleEntryBase {
    constructor(..._args7) {
      super(..._args7);
      this.box_name = "HEVCSampleEntry";
      this.colrs = [];
      this.subBoxNames = ["colr"];
    }
  }, _a76.fourcc = "hev1", _a76);
  var _a77;
  var hev2SampleEntry = (_a77 = class extends hvcCSampleEntryBase {
  }, _a77.fourcc = "hev2", _a77);
  var _a78;
  var hvt1SampleEntry = (_a78 = class extends VisualSampleEntry {
    constructor(..._args8) {
      super(..._args8);
      this.box_name = "HEVCTileSampleSampleEntry";
    }
  }, _a78.fourcc = "hvt1", _a78);
  var _a79;
  var lhe1SampleEntry = (_a79 = class extends VisualSampleEntry {
    constructor(..._args9) {
      super(..._args9);
      this.box_name = "LHEVCSampleEntry";
    }
  }, _a79.fourcc = "lhe1", _a79);
  var _a80;
  var lhv1SampleEntry = (_a80 = class extends VisualSampleEntry {
    constructor(..._args10) {
      super(..._args10);
      this.box_name = "LHEVCSampleEntry";
    }
  }, _a80.fourcc = "lhv1", _a80);
  var _a81;
  var lvc1SampleEntry = (_a81 = class extends VisualSampleEntry {
    constructor(..._args11) {
      super(..._args11);
      this.box_name = "LCEVCSampleEntry";
    }
    /** @bundle box-codecs.js */
    getCodec() {
      let baseCodec = super.getCodec();
      if (this.lvcC) {
        baseCodec += ".";
        baseCodec += "vprf";
        baseCodec += this.lvcC.LCEVCProfileIndication;
        baseCodec += ".";
        baseCodec += "vlev";
        baseCodec += this.lvcC.LCEVCLevelIndication;
      }
      return baseCodec;
    }
  }, _a81.fourcc = "lvc1", _a81);
  var _a82;
  var dvh1SampleEntry = (_a82 = class extends VisualSampleEntry {
  }, _a82.fourcc = "dvh1", _a82);
  var _a83;
  var dvheSampleEntry = (_a83 = class extends VisualSampleEntry {
  }, _a83.fourcc = "dvhe", _a83);
  var vvcCSampleEntryBase = class extends VisualSampleEntry {
    getCodec() {
      let baseCodec = super.getCodec();
      if (this.vvcC) {
        baseCodec += "." + this.vvcC.general_profile_idc;
        if (this.vvcC.general_tier_flag) baseCodec += ".H";
        else baseCodec += ".L";
        baseCodec += this.vvcC.general_level_idc;
        let constraint_string = "";
        if (this.vvcC.general_constraint_info) {
          const bytes = [];
          let byte = 0;
          byte |= this.vvcC.ptl_frame_only_constraint_flag << 7;
          byte |= this.vvcC.ptl_multilayer_enabled_flag << 6;
          let last_nonzero;
          for (let i = 0; i < this.vvcC.general_constraint_info.length; ++i) {
            byte |= this.vvcC.general_constraint_info[i] >> 2 & 63;
            bytes.push(byte);
            if (byte) last_nonzero = i;
            byte = this.vvcC.general_constraint_info[i] >> 2 & 3;
          }
          if (last_nonzero === void 0) constraint_string = ".CA";
          else {
            constraint_string = ".C";
            const base32_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            let held_bits = 0;
            let num_held_bits = 0;
            for (let i = 0; i <= last_nonzero; ++i) {
              held_bits = held_bits << 8 | bytes[i];
              num_held_bits += 8;
              while (num_held_bits >= 5) {
                const val = held_bits >> num_held_bits - 5 & 31;
                constraint_string += base32_chars[val];
                num_held_bits -= 5;
                held_bits &= (1 << num_held_bits) - 1;
              }
            }
            if (num_held_bits) {
              held_bits <<= 5 - num_held_bits;
              constraint_string += base32_chars[held_bits & 31];
            }
          }
        }
        baseCodec += constraint_string;
      }
      return baseCodec;
    }
  };
  var _a84;
  var vvc1SampleEntry = (_a84 = class extends vvcCSampleEntryBase {
    constructor(..._args12) {
      super(..._args12);
      this.box_name = "VvcSampleEntry";
    }
  }, _a84.fourcc = "vvc1", _a84);
  var _a85;
  var vvi1SampleEntry = (_a85 = class extends vvcCSampleEntryBase {
    constructor(..._args13) {
      super(..._args13);
      this.box_name = "VvcSampleEntry";
    }
  }, _a85.fourcc = "vvi1", _a85);
  var _a86;
  var vvs1SampleEntry = (_a86 = class extends VisualSampleEntry {
    constructor(..._args14) {
      super(..._args14);
      this.box_name = "VvcSampleEntry";
    }
  }, _a86.fourcc = "vvs1", _a86);
  var _a87;
  var vvcNSampleEntry = (_a87 = class extends VisualSampleEntry {
    constructor(..._args15) {
      super(..._args15);
      this.box_name = "VvcNonVCLSampleEntry";
    }
  }, _a87.fourcc = "vvcN", _a87);
  var vpcCSampleEntryBase = class extends VisualSampleEntry {
    getCodec() {
      const baseCodec = super.getCodec();
      let level = this.vpcC.level;
      if (level === 0) level = "00";
      let bitDepth = this.vpcC.bitDepth;
      if (bitDepth === 8) bitDepth = "08";
      return `${baseCodec}.0${this.vpcC.profile}.${level}.${bitDepth}`;
    }
  };
  var _a88;
  var vp08SampleEntry = (_a88 = class extends vpcCSampleEntryBase {
  }, _a88.fourcc = "vp08", _a88);
  var _a89;
  var vp09SampleEntry = (_a89 = class extends vpcCSampleEntryBase {
  }, _a89.fourcc = "vp09", _a89);
  var _a90;
  var avs3SampleEntry = (_a90 = class extends VisualSampleEntry {
  }, _a90.fourcc = "avs3", _a90);
  var _a91;
  var j2kiSampleEntry = (_a91 = class extends VisualSampleEntry {
    constructor(..._args16) {
      super(..._args16);
      this.box_name = "J2KSampleEntry";
    }
  }, _a91.fourcc = "j2ki", _a91);
  var _a92;
  var mjp2SampleEntry = (_a92 = class extends VisualSampleEntry {
  }, _a92.fourcc = "mjp2", _a92);
  var _a93;
  var mjpgSampleEntry = (_a93 = class extends VisualSampleEntry {
  }, _a93.fourcc = "mjpg", _a93);
  var _a94;
  var uncvSampleEntry = (_a94 = class extends VisualSampleEntry {
    constructor(..._args17) {
      super(..._args17);
      this.box_name = "UncompressedVideoSampleEntry";
    }
  }, _a94.fourcc = "uncv", _a94);
  var _a95;
  var mp4vSampleEntry = (_a95 = class extends VisualSampleEntry {
    constructor(..._args18) {
      super(..._args18);
      this.box_name = "MP4VisualSampleEntry";
    }
  }, _a95.fourcc = "mp4v", _a95);
  var _a96;
  var mp4aSampleEntry = (_a96 = class extends AudioSampleEntry {
    constructor(..._args19) {
      super(..._args19);
      this.box_name = "MP4AudioSampleEntry";
    }
    getCodec() {
      const baseCodec = super.getCodec();
      const esds = this.esds ?? this.wave?.esds;
      if (esds && esds.esd) {
        const oti = esds.esd.getOTI();
        const dsi = esds.esd.getAudioConfig();
        return baseCodec + "." + decimalToHex(oti) + (dsi ? "." + dsi : "");
      } else return baseCodec;
    }
  }, _a96.fourcc = "mp4a", _a96);
  var _a97;
  var m4aeSampleEntry = (_a97 = class extends AudioSampleEntry {
  }, _a97.fourcc = "m4ae", _a97);
  var _a98;
  var ac_3SampleEntry = (_a98 = class extends AudioSampleEntry {
  }, _a98.fourcc = "ac-3", _a98);
  var _a99;
  var ac_4SampleEntry = (_a99 = class extends AudioSampleEntry {
  }, _a99.fourcc = "ac-4", _a99);
  var _a100;
  var ec_3SampleEntry = (_a100 = class extends AudioSampleEntry {
  }, _a100.fourcc = "ec-3", _a100);
  var _a101;
  var OpusSampleEntry = (_a101 = class extends AudioSampleEntry {
  }, _a101.fourcc = "Opus", _a101);
  var _a102;
  var mha1SampleEntry = (_a102 = class extends AudioSampleEntry {
  }, _a102.fourcc = "mha1", _a102);
  var _a103;
  var mha2SampleEntry = (_a103 = class extends AudioSampleEntry {
  }, _a103.fourcc = "mha2", _a103);
  var _a104;
  var mhm1SampleEntry = (_a104 = class extends AudioSampleEntry {
  }, _a104.fourcc = "mhm1", _a104);
  var _a105;
  var mhm2SampleEntry = (_a105 = class extends AudioSampleEntry {
  }, _a105.fourcc = "mhm2", _a105);
  var _a106;
  var fLaCSampleEntry = (_a106 = class extends AudioSampleEntry {
  }, _a106.fourcc = "fLaC", _a106);
  var _a107;
  var encvSampleEntry = (_a107 = class extends VisualSampleEntry {
  }, _a107.fourcc = "encv", _a107);
  var _a108;
  var encaSampleEntry = (_a108 = class extends AudioSampleEntry {
  }, _a108.fourcc = "enca", _a108);
  var _a109;
  var encuSampleEntry = (_a109 = class extends SubtitleSampleEntry {
    constructor(..._args20) {
      super(..._args20);
      this.subBoxNames = ["sinf"];
      this.sinfs = [];
    }
  }, _a109.fourcc = "encu", _a109);
  var _a110;
  var encsSampleEntry = (_a110 = class extends SystemSampleEntry {
    constructor(..._args21) {
      super(..._args21);
      this.subBoxNames = ["sinf"];
      this.sinfs = [];
    }
  }, _a110.fourcc = "encs", _a110);
  var _a111;
  var mp4sSampleEntry = (_a111 = class extends SystemSampleEntry {
  }, _a111.fourcc = "mp4s", _a111);
  var _a112;
  var enctSampleEntry = (_a112 = class extends TextSampleEntry {
    constructor(..._args22) {
      super(..._args22);
      this.subBoxNames = ["sinf"];
      this.sinfs = [];
    }
  }, _a112.fourcc = "enct", _a112);
  var _a113;
  var encmSampleEntry = (_a113 = class extends MetadataSampleEntry {
    constructor(..._args23) {
      super(..._args23);
      this.subBoxNames = ["sinf"];
      this.sinfs = [];
    }
  }, _a113.fourcc = "encm", _a113);
  var _a114;
  var resvSampleEntry = (_a114 = class extends VisualSampleEntry {
    constructor(..._args24) {
      super(..._args24);
      this.box_name = "RestrictedVideoSampleEntry";
    }
  }, _a114.fourcc = "resv", _a114);
  var _a115;
  var sbttSampleEntry = (_a115 = class extends SubtitleSampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      this.content_encoding = stream.readCString();
      this.mime_format = stream.readCString();
      this.parseFooter(stream);
    }
  }, _a115.fourcc = "sbtt", _a115);
  var _a116;
  var stppSampleEntry = (_a116 = class extends SubtitleSampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      this.namespace = stream.readCString();
      this.schema_location = stream.readCString();
      this.auxiliary_mime_types = stream.readCString();
      this.parseFooter(stream);
    }
    /** @bundle writing/sampleentry.js */
    write(stream) {
      this.writeHeader(stream);
      this.size += this.namespace.length + 1 + this.schema_location.length + 1 + this.auxiliary_mime_types.length + 1;
      stream.writeCString(this.namespace);
      stream.writeCString(this.schema_location);
      stream.writeCString(this.auxiliary_mime_types);
      this.writeFooter(stream);
    }
  }, _a116.fourcc = "stpp", _a116);
  var _a117;
  var stxtSampleEntry = (_a117 = class extends SubtitleSampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      this.content_encoding = stream.readCString();
      this.mime_format = stream.readCString();
      this.parseFooter(stream);
    }
    getCodec() {
      const baseCodec = super.getCodec();
      if (this.mime_format) return baseCodec + "." + this.mime_format;
      else return baseCodec;
    }
  }, _a117.fourcc = "stxt", _a117);
  var _a118;
  var tx3gSampleEntry = (_a118 = class extends SubtitleSampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      this.displayFlags = stream.readUint32();
      this.horizontal_justification = stream.readInt8();
      this.vertical_justification = stream.readInt8();
      this.bg_color_rgba = stream.readUint8Array(4);
      this.box_record = stream.readInt16Array(4);
      this.style_record = stream.readUint8Array(12);
      this.parseFooter(stream);
    }
  }, _a118.fourcc = "tx3g", _a118);
  var _a119;
  var wvttSampleEntry = (_a119 = class extends MetadataSampleEntry {
    parse(stream) {
      this.parseHeader(stream);
      this.parseFooter(stream);
    }
  }, _a119.fourcc = "wvtt", _a119);
  var _a120;
  var sbgpBox = (_a120 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SampleToGroupBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.grouping_type = stream.readString(4);
      if (this.version === 1) this.grouping_type_parameter = stream.readUint32();
      else this.grouping_type_parameter = 0;
      this.entries = [];
      const entry_count = stream.readUint32();
      for (let i = 0; i < entry_count; i++) this.entries.push({
        sample_count: stream.readInt32(),
        group_description_index: stream.readInt32()
      });
    }
    /** @bundle writing/sbgp.js */
    write(stream) {
      if (this.grouping_type_parameter) this.version = 1;
      else this.version = 0;
      this.flags = 0;
      this.size = 8 + 8 * this.entries.length + (this.version === 1 ? 4 : 0);
      this.writeHeader(stream);
      stream.writeString(this.grouping_type, void 0, 4);
      if (this.version === 1) stream.writeUint32(this.grouping_type_parameter);
      stream.writeUint32(this.entries.length);
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        stream.writeInt32(entry.sample_count);
        stream.writeInt32(entry.group_description_index);
      }
    }
  }, _a120.fourcc = "sbgp", _a120);
  var _a121;
  var sdtpBox = (_a121 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SampleDependencyTypeBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const count = this.size - this.hdr_size;
      this.is_leading = [];
      this.sample_depends_on = [];
      this.sample_is_depended_on = [];
      this.sample_has_redundancy = [];
      for (let i = 0; i < count; i++) {
        const tmp_byte = stream.readUint8();
        this.is_leading[i] = tmp_byte >> 6;
        this.sample_depends_on[i] = tmp_byte >> 4 & 3;
        this.sample_is_depended_on[i] = tmp_byte >> 2 & 3;
        this.sample_has_redundancy[i] = tmp_byte & 3;
      }
    }
  }, _a121.fourcc = "sdtp", _a121);
  var _a122;
  var sgpdBox = (_a122 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SampleGroupDescriptionBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.grouping_type = stream.readString(4);
      Log.debug("BoxParser", "Found Sample Groups of type " + this.grouping_type);
      if (this.version === 1) this.default_length = stream.readUint32();
      else this.default_length = 0;
      if (this.version >= 2) this.default_group_description_index = stream.readUint32();
      this.entries = [];
      const entry_count = stream.readUint32();
      for (let i = 0; i < entry_count; i++) {
        let entry;
        if (this.grouping_type in BoxRegistry.sampleGroupEntry) entry = new BoxRegistry.sampleGroupEntry[this.grouping_type](this.grouping_type);
        else entry = new SampleGroupEntry(this.grouping_type);
        this.entries.push(entry);
        if (this.version === 1) if (this.default_length === 0) entry.description_length = stream.readUint32();
        else entry.description_length = this.default_length;
        else entry.description_length = this.default_length;
        if (entry.write === SampleGroupEntry.prototype.write) {
          Log.info("BoxParser", "SampleGroup for type " + this.grouping_type + " writing not yet implemented, keeping unparsed data in memory for later write");
          entry.data = stream.readUint8Array(entry.description_length);
          stream.seek(stream.getPosition() - entry.description_length);
        }
        entry.parse(stream);
      }
    }
    /** @bundle writing/sgpd.js */
    write(stream) {
      this.flags = 0;
      this.size = 12;
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        if (this.version === 1) {
          if (this.default_length === 0) this.size += 4;
          this.size += entry.data.length;
        }
      }
      this.writeHeader(stream);
      stream.writeString(this.grouping_type, void 0, 4);
      if (this.version === 1) stream.writeUint32(this.default_length);
      if (this.version >= 2) stream.writeUint32(this.default_sample_description_index);
      stream.writeUint32(this.entries.length);
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        if (this.version === 1) {
          if (this.default_length === 0) stream.writeUint32(entry.description_length);
        }
        entry.write(stream);
      }
    }
  }, _a122.fourcc = "sgpd", _a122);
  var _a123;
  var sidxBox = (_a123 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CompressedSegmentIndexBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.reference_ID = stream.readUint32();
      this.timescale = stream.readUint32();
      if (this.version === 0) {
        this.earliest_presentation_time = stream.readUint32();
        this.first_offset = stream.readUint32();
      } else {
        this.earliest_presentation_time = stream.readUint64();
        this.first_offset = stream.readUint64();
      }
      stream.readUint16();
      this.references = [];
      const count = stream.readUint16();
      for (let i = 0; i < count; i++) {
        const type = stream.readUint32();
        const subsegment_duration = stream.readUint32();
        const sap = stream.readUint32();
        this.references.push({
          reference_type: type >> 31 & 1,
          referenced_size: type & 2147483647,
          subsegment_duration,
          starts_with_SAP: sap >> 31 & 1,
          SAP_type: sap >> 28 & 7,
          SAP_delta_time: sap & 268435455
        });
      }
    }
    /** @bundle writing/sidx.js */
    write(stream) {
      const useVersion1 = this.earliest_presentation_time > MAX_UINT32 || this.first_offset > MAX_UINT32 || this.version === 1;
      this.version = useVersion1 ? 1 : 0;
      this.size = 12 + 12 * this.references.length;
      this.size += useVersion1 ? 16 : 8;
      this.flags = 0;
      this.writeHeader(stream);
      stream.writeUint32(this.reference_ID);
      stream.writeUint32(this.timescale);
      if (useVersion1) {
        stream.writeUint64(this.earliest_presentation_time);
        stream.writeUint64(this.first_offset);
      } else {
        stream.writeUint32(this.earliest_presentation_time);
        stream.writeUint32(this.first_offset);
      }
      stream.writeUint16(0);
      stream.writeUint16(this.references.length);
      for (let i = 0; i < this.references.length; i++) {
        const ref = this.references[i];
        stream.writeUint32(ref.reference_type << 31 | ref.referenced_size);
        stream.writeUint32(ref.subsegment_duration);
        stream.writeUint32(ref.starts_with_SAP << 31 | ref.SAP_type << 28 | ref.SAP_delta_time);
      }
    }
  }, _a123.fourcc = "sidx", _a123);
  var _a124;
  var smhdBox = (_a124 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SoundMediaHeaderBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.balance = stream.readUint16();
      stream.readUint16();
    }
    /** @bundle writing/smhd.js */
    write(stream) {
      this.version = 0;
      this.size = 4;
      this.writeHeader(stream);
      stream.writeUint16(this.balance);
      stream.writeUint16(0);
    }
  }, _a124.fourcc = "smhd", _a124);
  var _a125;
  var stcoBox = (_a125 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ChunkOffsetBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const entry_count = stream.readUint32();
      this.chunk_offsets = [];
      if (this.version === 0) for (let i = 0; i < entry_count; i++) this.chunk_offsets.push(stream.readUint32());
    }
    /** @bundle writings/stco.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 4 * this.chunk_offsets.length;
      this.writeHeader(stream);
      stream.writeUint32(this.chunk_offsets.length);
      stream.writeUint32Array(this.chunk_offsets);
    }
    /** @bundle box-unpack.js */
    unpack(samples) {
      for (let i = 0; i < this.chunk_offsets.length; i++) samples[i].offset = this.chunk_offsets[i];
    }
  }, _a125.fourcc = "stco", _a125);
  var _a126;
  var sthdBox = (_a126 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SubtitleMediaHeaderBox";
    }
  }, _a126.fourcc = "sthd", _a126);
  var _a127;
  var stscBox = (_a127 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SampleToChunkBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const entry_count = stream.readUint32();
      this.first_chunk = [];
      this.samples_per_chunk = [];
      this.sample_description_index = [];
      if (this.version === 0) for (let i = 0; i < entry_count; i++) {
        this.first_chunk.push(stream.readUint32());
        this.samples_per_chunk.push(stream.readUint32());
        this.sample_description_index.push(stream.readUint32());
      }
    }
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 12 * this.first_chunk.length;
      this.writeHeader(stream);
      stream.writeUint32(this.first_chunk.length);
      for (let i = 0; i < this.first_chunk.length; i++) {
        stream.writeUint32(this.first_chunk[i]);
        stream.writeUint32(this.samples_per_chunk[i]);
        stream.writeUint32(this.sample_description_index[i]);
      }
    }
    unpack(samples) {
      let l = 0;
      let m = 0;
      for (let i = 0; i < this.first_chunk.length; i++) for (let j = 0; j < (i + 1 < this.first_chunk.length ? this.first_chunk[i + 1] : Infinity); j++) {
        m++;
        for (let k = 0; k < this.samples_per_chunk[i]; k++) {
          if (samples[l]) {
            samples[l].description_index = this.sample_description_index[i];
            samples[l].chunk_index = m;
          } else return;
          l++;
        }
      }
    }
  }, _a127.fourcc = "stsc", _a127);
  var _a128;
  var stsdBox = (_a128 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SampleDescriptionBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.entries = [];
      const entryCount = stream.readUint32();
      for (let i = 1; i <= entryCount; i++) {
        const ret = parseOneBox(stream, true, this.size - (stream.getPosition() - this.start));
        if (ret.code === 1) {
          let box2;
          if (ret.type in BoxRegistry.sampleEntry) {
            box2 = new BoxRegistry.sampleEntry[ret.type](ret.size);
            box2.hdr_size = ret.hdr_size;
            box2.start = ret.start;
          } else {
            Log.warn("BoxParser", `Unknown sample entry type: '${ret.type}'`);
            box2 = new SampleEntry(ret.size, ret.hdr_size, ret.start);
            box2.type = ret.type;
          }
          if (box2.write === SampleEntry.prototype.write) {
            Log.info("BoxParser", "SampleEntry " + box2.type + " box writing not yet implemented, keeping unparsed data in memory for later write");
            box2.parseDataAndRewind(stream);
          }
          box2.parse(stream);
          this.entries.push(box2);
        } else return;
      }
    }
    /** @bundle writing/stsd.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 0;
      this.writeHeader(stream);
      stream.writeUint32(this.entries.length);
      this.size += 4;
      for (let i = 0; i < this.entries.length; i++) {
        this.entries[i].write(stream);
        this.size += this.entries[i].size;
      }
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    }
  }, _a128.fourcc = "stsd", _a128);
  var _a129;
  var stszBox = (_a129 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SampleSizeBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.sample_sizes = [];
      if (this.version === 0) {
        this.sample_size = stream.readUint32();
        this.sample_count = stream.readUint32();
        for (let i = 0; i < this.sample_count; i++) if (this.sample_size === 0) this.sample_sizes.push(stream.readUint32());
        else this.sample_sizes[i] = this.sample_size;
      }
    }
    /** @bundle writing/stsz.js */
    write(stream) {
      let constant = true;
      this.version = 0;
      this.flags = 0;
      if (this.sample_sizes.length > 0 && this.sample_size === 0) constant = false;
      this.size = 8;
      if (!constant) this.size += 4 * this.sample_sizes.length;
      this.writeHeader(stream);
      stream.writeUint32(this.sample_size);
      stream.writeUint32(this.sample_sizes.length);
      if (!constant) stream.writeUint32Array(this.sample_sizes);
    }
    /** @bundle box-unpack.js */
    unpack(samples) {
      for (let i = 0; i < this.sample_sizes.length; i++) samples[i].size = this.sample_sizes[i];
    }
  }, _a129.fourcc = "stsz", _a129);
  var _a130;
  var sttsBox = (_a130 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TimeToSampleBox";
      this.sample_counts = [];
      this.sample_deltas = [];
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const entry_count = stream.readUint32();
      this.sample_counts.length = 0;
      this.sample_deltas.length = 0;
      if (this.version === 0) for (let i = 0; i < entry_count; i++) {
        this.sample_counts.push(stream.readUint32());
        let delta = stream.readInt32();
        if (delta < 0) {
          Log.warn("BoxParser", "File uses negative stts sample delta, using value 1 instead, sync may be lost!");
          delta = 1;
        }
        this.sample_deltas.push(delta);
      }
    }
    /** @bundle writing/stts.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 8 * this.sample_counts.length;
      this.writeHeader(stream);
      stream.writeUint32(this.sample_counts.length);
      for (let i = 0; i < this.sample_counts.length; i++) {
        stream.writeUint32(this.sample_counts[i]);
        stream.writeUint32(this.sample_deltas[i]);
      }
    }
    /** @bundle box-unpack.js */
    unpack(samples) {
      let k = 0;
      for (let i = 0; i < this.sample_counts.length; i++) for (let j = 0; j < this.sample_counts[i]; j++) {
        if (k === 0) samples[k].dts = 0;
        else samples[k].dts = samples[k - 1].dts + this.sample_deltas[i];
        k++;
      }
    }
  }, _a130.fourcc = "stts", _a130);
  var _a131;
  var tfdtBox = (_a131 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackFragmentBaseMediaDecodeTimeBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 1) this.baseMediaDecodeTime = stream.readUint64();
      else this.baseMediaDecodeTime = stream.readUint32();
    }
    /** @bundle writing/tdft.js */
    write(stream) {
      const useVersion1 = this.baseMediaDecodeTime > MAX_UINT32 || this.version === 1;
      this.version = useVersion1 ? 1 : 0;
      this.size = 4;
      this.size += useVersion1 ? 4 : 0;
      this.flags = 0;
      this.writeHeader(stream);
      if (useVersion1) stream.writeUint64(this.baseMediaDecodeTime);
      else stream.writeUint32(this.baseMediaDecodeTime);
    }
  }, _a131.fourcc = "tfdt", _a131);
  var _a132;
  var tfhdBox = (_a132 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackFragmentHeaderBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      let readBytes = 0;
      this.track_id = stream.readUint32();
      if (this.size - this.hdr_size > readBytes && this.flags & 1) {
        this.base_data_offset = stream.readUint64();
        readBytes += 8;
      } else this.base_data_offset = 0;
      if (this.size - this.hdr_size > readBytes && this.flags & 2) {
        this.default_sample_description_index = stream.readUint32();
        readBytes += 4;
      } else this.default_sample_description_index = 0;
      if (this.size - this.hdr_size > readBytes && this.flags & 8) {
        this.default_sample_duration = stream.readUint32();
        readBytes += 4;
      } else this.default_sample_duration = 0;
      if (this.size - this.hdr_size > readBytes && this.flags & 16) {
        this.default_sample_size = stream.readUint32();
        readBytes += 4;
      } else this.default_sample_size = 0;
      if (this.size - this.hdr_size > readBytes && this.flags & 32) {
        this.default_sample_flags = stream.readUint32();
        readBytes += 4;
      } else this.default_sample_flags = 0;
    }
    /** @bundle writing/tfhd.js */
    write(stream) {
      this.version = 0;
      this.size = 4;
      if (this.flags & 1) this.size += 8;
      if (this.flags & 2) this.size += 4;
      if (this.flags & 8) this.size += 4;
      if (this.flags & 16) this.size += 4;
      if (this.flags & 32) this.size += 4;
      this.writeHeader(stream);
      stream.writeUint32(this.track_id);
      if (this.flags & 1) stream.writeUint64(this.base_data_offset);
      if (this.flags & 2) stream.writeUint32(this.default_sample_description_index);
      if (this.flags & 8) stream.writeUint32(this.default_sample_duration);
      if (this.flags & 16) stream.writeUint32(this.default_sample_size);
      if (this.flags & 32) stream.writeUint32(this.default_sample_flags);
    }
  }, _a132.fourcc = "tfhd", _a132);
  var _a133;
  var tkhdBox = (_a133 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackHeaderBox";
      this.layer = 0;
      this.alternate_group = 0;
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 1) {
        this.creation_time = stream.readUint64();
        this.modification_time = stream.readUint64();
        this.track_id = stream.readUint32();
        stream.readUint32();
        this.duration = stream.readUint64();
      } else {
        this.creation_time = stream.readUint32();
        this.modification_time = stream.readUint32();
        this.track_id = stream.readUint32();
        stream.readUint32();
        this.duration = stream.readUint32();
      }
      stream.readUint32Array(2);
      this.layer = stream.readInt16();
      this.alternate_group = stream.readInt16();
      this.volume = stream.readInt16() >> 8;
      stream.readUint16();
      this.matrix = stream.readInt32Array(9);
      this.width = stream.readUint32();
      this.height = stream.readUint32();
    }
    write(stream) {
      const useVersion1 = this.modification_time > MAX_UINT32 || this.creation_time > MAX_UINT32 || this.duration > MAX_UINT32 || this.version === 1;
      this.version = useVersion1 ? 1 : 0;
      this.size = 80;
      this.size += useVersion1 ? 12 : 0;
      this.flags = this.flags ?? 3;
      this.writeHeader(stream);
      if (useVersion1) {
        stream.writeUint64(this.creation_time);
        stream.writeUint64(this.modification_time);
        stream.writeUint32(this.track_id);
        stream.writeUint32(0);
        stream.writeUint64(this.duration);
      } else {
        stream.writeUint32(this.creation_time);
        stream.writeUint32(this.modification_time);
        stream.writeUint32(this.track_id);
        stream.writeUint32(0);
        stream.writeUint32(this.duration);
      }
      stream.writeUint32Array([0, 0]);
      stream.writeInt16(this.layer);
      stream.writeInt16(this.alternate_group);
      stream.writeInt16(this.volume << 8);
      stream.writeInt16(0);
      stream.writeInt32Array(this.matrix);
      stream.writeUint32(this.width);
      stream.writeUint32(this.height);
    }
    /** @bundle box-print.js */
    print(output) {
      super.printHeader(output);
      output.log(output.indent + "creation_time: " + this.creation_time);
      output.log(output.indent + "modification_time: " + this.modification_time);
      output.log(output.indent + "track_id: " + this.track_id);
      output.log(output.indent + "duration: " + this.duration);
      output.log(output.indent + "volume: " + (this.volume >> 8));
      output.log(output.indent + "matrix: " + this.matrix.join(", "));
      output.log(output.indent + "layer: " + this.layer);
      output.log(output.indent + "alternate_group: " + this.alternate_group);
      output.log(output.indent + "width: " + this.width);
      output.log(output.indent + "height: " + this.height);
    }
  }, _a133.fourcc = "tkhd", _a133);
  var _a134;
  var trexBox = (_a134 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackExtendsBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.track_id = stream.readUint32();
      this.default_sample_description_index = stream.readUint32();
      this.default_sample_duration = stream.readUint32();
      this.default_sample_size = stream.readUint32();
      this.default_sample_flags = stream.readUint32();
    }
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 20;
      this.writeHeader(stream);
      stream.writeUint32(this.track_id);
      stream.writeUint32(this.default_sample_description_index);
      stream.writeUint32(this.default_sample_duration);
      stream.writeUint32(this.default_sample_size);
      stream.writeUint32(this.default_sample_flags);
    }
  }, _a134.fourcc = "trex", _a134);
  var _a135;
  var trunBox = (_a135 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackRunBox";
      this.sample_duration = [];
      this.sample_size = [];
      this.sample_flags = [];
      this.sample_composition_time_offset = [];
    }
    parse(stream) {
      this.parseFullHeader(stream);
      let readBytes = 0;
      this.sample_count = stream.readUint32();
      readBytes += 4;
      if (this.size - this.hdr_size > readBytes && this.flags & 1) {
        this.data_offset = stream.readInt32();
        readBytes += 4;
      } else this.data_offset = 0;
      if (this.size - this.hdr_size > readBytes && this.flags & 4) {
        this.first_sample_flags = stream.readUint32();
        readBytes += 4;
      } else this.first_sample_flags = 0;
      this.sample_duration = [];
      this.sample_size = [];
      this.sample_flags = [];
      this.sample_composition_time_offset = [];
      if (this.size - this.hdr_size > readBytes) for (let i = 0; i < this.sample_count; i++) {
        if (this.flags & 256) this.sample_duration[i] = stream.readUint32();
        if (this.flags & 512) this.sample_size[i] = stream.readUint32();
        if (this.flags & 1024) this.sample_flags[i] = stream.readUint32();
        if (this.flags & 2048) if (this.version === 0) this.sample_composition_time_offset[i] = stream.readUint32();
        else this.sample_composition_time_offset[i] = stream.readInt32();
      }
    }
    /** @bundle writing/trun.js */
    write(stream) {
      this.size = 4;
      if (this.flags & 1) this.size += 4;
      if (this.flags & 4) this.size += 4;
      if (this.flags & 256) this.size += 4 * this.sample_duration.length;
      if (this.flags & 512) this.size += 4 * this.sample_size.length;
      if (this.flags & 1024) this.size += 4 * this.sample_flags.length;
      if (this.flags & 2048) this.size += 4 * this.sample_composition_time_offset.length;
      this.writeHeader(stream);
      stream.writeUint32(this.sample_count);
      if (this.flags & 1) {
        this.data_offset_position = stream.getPosition();
        stream.writeInt32(this.data_offset);
      }
      if (this.flags & 4) stream.writeUint32(this.first_sample_flags);
      for (let i = 0; i < this.sample_count; i++) {
        if (this.flags & 256) stream.writeUint32(this.sample_duration[i]);
        if (this.flags & 512) stream.writeUint32(this.sample_size[i]);
        if (this.flags & 1024) stream.writeUint32(this.sample_flags[i]);
        if (this.flags & 2048) if (this.version === 0) stream.writeUint32(this.sample_composition_time_offset[i]);
        else stream.writeInt32(this.sample_composition_time_offset[i]);
      }
    }
  }, _a135.fourcc = "trun", _a135);
  var _a136;
  var urlBox = (_a136 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "DataEntryUrlBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.flags !== 1) this.location = stream.readCString();
    }
    /** @bundle writing/url.js */
    write(stream) {
      this.version = 0;
      if (this.location) {
        this.flags = 0;
        this.size = this.location.length + 1;
      } else {
        this.flags = 1;
        this.size = 0;
      }
      this.writeHeader(stream);
      if (this.location) stream.writeCString(this.location);
    }
  }, _a136.fourcc = "url ", _a136);
  var _a137;
  var vmhdBox = (_a137 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "VideoMediaHeaderBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.graphicsmode = stream.readUint16();
      this.opcolor = stream.readUint16Array(3);
    }
    /** @bundle writing/vmhd.js */
    write(stream) {
      this.version = 0;
      this.size = 8;
      this.writeHeader(stream);
      stream.writeUint16(this.graphicsmode);
      stream.writeUint16Array(this.opcolor);
    }
  }, _a137.fourcc = "vmhd", _a137);
  var SampleGroupInfo = class {
    constructor(grouping_type, grouping_type_parameter, sbgp) {
      this.grouping_type = grouping_type;
      this.grouping_type_parameter = grouping_type_parameter;
      this.sbgp = sbgp;
      this.last_sample_in_run = -1;
      this.entry_index = -1;
    }
  };
  var ISOFile = class ISOFile2 {
    constructor(stream, discardMdatData = true) {
      this.boxes = [];
      this.mdats = [];
      this.moofs = [];
      this.isProgressive = false;
      this.moovStartFound = false;
      this.moovStartSent = false;
      this.readySent = false;
      this.sampleListBuilt = false;
      this.fragmentedTracks = [];
      this.extractedTracks = [];
      this.isFragmentationInitialized = false;
      this.sampleProcessingStarted = false;
      this.nextMoofNumber = 0;
      this.itemListBuilt = false;
      this.sidxSent = false;
      this.items = [];
      this.entity_groups = [];
      this.itemsDataSize = 0;
      this.lastMoofIndex = 0;
      this.samplesDataSize = 0;
      this.lastBoxStartPosition = 0;
      this.nextParsePosition = 0;
      this.discardMdatData = true;
      this.discardMdatData = discardMdatData;
      if (stream) {
        this.stream = stream;
        this.parse();
      } else this.stream = new MultiBufferStream();
      this.stream.isofile = this;
    }
    setSegmentOptions(id, user, opts) {
      const { sizePerSegment = Number.MAX_SAFE_INTEGER, rapAlignement = true, normalizeAudioSampleEntriesForMSE = true } = opts;
      let nbSamples = opts.nbSamples ?? opts.nbSamplesPerFragment ?? 1e3;
      const nbSamplesPerFragment = opts.nbSamplesPerFragment ?? nbSamples;
      if (nbSamples <= 0 || nbSamplesPerFragment <= 0 || sizePerSegment <= 0) {
        Log.error("ISOFile", `Invalid segment options: nbSamples=${nbSamples}, nbSamplesPerFragment=${nbSamplesPerFragment}, sizePerSegment=${sizePerSegment}`);
        return;
      }
      if (nbSamples < nbSamplesPerFragment) {
        Log.warn("ISOFile", `nbSamples (${nbSamples}) is less than nbSamplesPerFragment (${nbSamplesPerFragment}), setting nbSamples to nbSamplesPerFragment`);
        nbSamples = nbSamplesPerFragment;
      }
      if (this.fragmentedTracks.some((track) => track.nb_samples !== nbSamples)) {
        Log.error("ISOFile", `Cannot set segment options for track ${id}: nbSamples (${nbSamples}) does not match existing tracks`);
        return;
      }
      const trak = this.getTrackById(id);
      if (trak) {
        const fragTrack = {
          id,
          user,
          trak,
          segmentStream: void 0,
          nb_samples: nbSamples,
          nb_samples_per_fragment: nbSamplesPerFragment,
          size_per_segment: sizePerSegment,
          rapAlignement,
          normalizeAudioSampleEntriesForMSE,
          state: {
            lastFragmentSampleNumber: 0,
            lastSegmentSampleNumber: 0,
            accumulatedSize: 0
          }
        };
        this.fragmentedTracks.push(fragTrack);
        trak.nextSample = 0;
      }
      if (this.discardMdatData) Log.warn("ISOFile", "Segmentation options set but discardMdatData is true, samples will not be segmented");
    }
    unsetSegmentOptions(id) {
      let index = -1;
      for (let i = 0; i < this.fragmentedTracks.length; i++) if (this.fragmentedTracks[i].id === id) index = i;
      if (index > -1) this.fragmentedTracks.splice(index, 1);
    }
    setExtractionOptions(id, user, { nbSamples: nb_samples = 1e3 } = {}) {
      const trak = this.getTrackById(id);
      if (trak) {
        this.extractedTracks.push({
          id,
          user,
          trak,
          nb_samples,
          samples: []
        });
        trak.nextSample = 0;
      }
      if (this.discardMdatData) Log.warn("ISOFile", "Extraction options set but discardMdatData is true, samples will not be extracted");
    }
    unsetExtractionOptions(id) {
      let index = -1;
      for (let i = 0; i < this.extractedTracks.length; i++) if (this.extractedTracks[i].id === id) index = i;
      if (index > -1) this.extractedTracks.splice(index, 1);
    }
    parse() {
      const parseBoxHeadersOnly = false;
      if (this.restoreParsePosition) {
        if (!this.restoreParsePosition()) return;
      }
      while (true) if (this.hasIncompleteMdat && this.hasIncompleteMdat()) if (this.processIncompleteMdat()) continue;
      else return;
      else {
        if (this.saveParsePosition) this.saveParsePosition();
        const ret = parseOneBox(this.stream, parseBoxHeadersOnly);
        if (ret.code === 0) if (this.processIncompleteBox) if (this.processIncompleteBox(ret)) continue;
        else return;
        else return;
        else if (ret.code === 1) {
          const box2 = ret.box;
          this.boxes.push(box2);
          if (box2.type === "uuid") {
            if (this[box2.uuid] !== void 0) Log.warn("ISOFile", "Duplicate Box of uuid: " + box2.uuid + ", overriding previous occurrence");
            this[box2.uuid] = box2;
          } else switch (box2.type) {
            case "mdat":
              this.mdats.push(box2);
              this.transferMdatData(box2);
              break;
            case "moof":
              this.moofs.push(box2);
              break;
            case "free":
            case "skip":
              break;
            case "moov":
              this.moovStartFound = true;
              if (this.mdats.length === 0) this.isProgressive = true;
            default:
              if (this[box2.type] !== void 0) if (Array.isArray(this[box2.type + "s"])) {
                Log.info("ISOFile", `Found multiple boxes of type ${box2.type} in ISOFile, adding to array`);
                this[box2.type + "s"].push(box2);
              } else {
                Log.warn("ISOFile", `Found multiple boxes of type ${box2.type} but no array exists. Creating array dynamically.`);
                this[box2.type + "s"] = [this[box2.type], box2];
              }
              else {
                this[box2.type] = box2;
                if (Array.isArray(this[box2.type + "s"])) this[box2.type + "s"].push(box2);
              }
              break;
          }
          if (this.updateUsedBytes) this.updateUsedBytes(box2, ret);
        } else if (ret.code === -1) {
          Log.error("ISOFile", `Invalid data found while parsing box of type '${ret.type}' at position ${ret.start}. Aborting parsing.`, this);
          break;
        }
      }
    }
    checkBuffer(ab) {
      if (!ab) throw new Error("Buffer must be defined and non empty");
      if (ab.byteLength === 0) {
        Log.warn("ISOFile", "Ignoring empty buffer (fileStart: " + ab.fileStart + ")");
        this.stream.logBufferLevel();
        return false;
      }
      Log.info("ISOFile", "Processing buffer (fileStart: " + ab.fileStart + ")");
      ab.usedBytes = 0;
      this.stream.insertBuffer(ab);
      this.stream.logBufferLevel();
      if (!this.stream.initialized()) {
        Log.warn("ISOFile", "Not ready to start parsing");
        return false;
      }
      return true;
    }
    /**
    * Processes a new ArrayBuffer (with a fileStart property)
    * Returns the next expected file position, or undefined if not ready to parse
    */
    appendBuffer(ab, last) {
      let nextFileStart;
      if (!this.checkBuffer(ab)) return;
      this.parse();
      if (this.moovStartFound && !this.moovStartSent) {
        this.moovStartSent = true;
        if (this.onMoovStart) this.onMoovStart();
      }
      if (this.moov) {
        if (!this.sampleListBuilt) {
          this.buildSampleLists();
          this.sampleListBuilt = true;
        }
        this.updateSampleLists();
        if (this.onReady && !this.readySent) {
          this.readySent = true;
          this.onReady(this.getInfo());
        }
        this.processSamples(last);
        if (this.nextSeekPosition) {
          nextFileStart = this.nextSeekPosition;
          this.nextSeekPosition = void 0;
        } else nextFileStart = this.nextParsePosition;
        if (this.stream.getEndFilePositionAfter) nextFileStart = this.stream.getEndFilePositionAfter(nextFileStart);
      } else if (this.nextParsePosition) nextFileStart = this.nextParsePosition;
      else nextFileStart = 0;
      if (this.sidx) {
        if (this.onSidx && !this.sidxSent) {
          this.onSidx(this.sidx);
          this.sidxSent = true;
        }
      }
      if (this.meta) {
        if (this.flattenItemInfo && !this.itemListBuilt) {
          this.flattenItemInfo();
          this.itemListBuilt = true;
        }
        if (this.processItems) this.processItems(this.onItem);
      }
      if (this.stream.cleanBuffers) {
        Log.info("ISOFile", "Done processing buffer (fileStart: " + ab.fileStart + ") - next buffer to fetch should have a fileStart position of " + nextFileStart);
        this.stream.logBufferLevel();
        this.stream.cleanBuffers();
        this.stream.logBufferLevel(true);
        Log.info("ISOFile", "Sample data size in memory: " + this.getAllocatedSampleDataSize());
      }
      return nextFileStart;
    }
    getFragmentDuration() {
      const mvex = this.getBox("mvex");
      if (!mvex) return;
      if (mvex.mehd) return {
        num: mvex.mehd.fragment_duration,
        den: this.moov.mvhd.timescale
      };
      const traks = this.getBoxes("trak", false);
      let maximum = {
        num: 0,
        den: 1
      };
      for (const trak of traks) {
        const duration = trak.samples_duration;
        const timescale = trak.mdia.mdhd.timescale;
        if (duration && timescale) {
          if (duration / timescale > maximum.num / maximum.den) maximum = {
            num: duration,
            den: timescale
          };
        }
      }
      return maximum;
    }
    getInfo() {
      if (!this.moov) return {
        hasMoov: false,
        mime: ""
      };
      const _1904 = (/* @__PURE__ */ new Date("1904-01-01T00:00:00Z")).getTime();
      const isFragmented = this.getBox("mvex") !== void 0;
      const movie = {
        hasMoov: true,
        duration: this.moov.mvhd.duration,
        timescale: this.moov.mvhd.timescale,
        isFragmented,
        fragment_duration: this.getFragmentDuration(),
        isProgressive: this.isProgressive,
        hasIOD: this.moov.iods !== void 0,
        brands: [this.ftyp.major_brand].concat(this.ftyp.compatible_brands),
        created: new Date(_1904 + this.moov.mvhd.creation_time * 1e3),
        modified: new Date(_1904 + this.moov.mvhd.modification_time * 1e3),
        tracks: [],
        audioTracks: [],
        videoTracks: [],
        subtitleTracks: [],
        metadataTracks: [],
        hintTracks: [],
        otherTracks: [],
        mime: ""
      };
      for (let i = 0; i < this.moov.traks.length; i++) {
        const trak = this.moov.traks[i];
        const sample_desc = trak.mdia.minf.stbl.stsd.entries[0];
        const size = trak.samples_size;
        const track_timescale = trak.mdia.mdhd.timescale;
        const samples_duration = trak.samples_duration;
        const track = {
          samples_duration,
          bitrate: size * 8 * track_timescale / samples_duration,
          size,
          timescale: track_timescale,
          alternate_group: trak.tkhd.alternate_group,
          codec: sample_desc.getCodec(),
          created: new Date(_1904 + trak.tkhd.creation_time * 1e3),
          cts_shift: trak.mdia.minf.stbl.cslg,
          duration: trak.mdia.mdhd.duration,
          id: trak.tkhd.track_id,
          kind: trak.udta && trak.udta.kinds.length ? trak.udta.kinds[0] : {
            schemeURI: "",
            value: ""
          },
          language: trak.mdia.elng ? trak.mdia.elng.extended_language : trak.mdia.mdhd.languageString,
          layer: trak.tkhd.layer,
          matrix: trak.tkhd.matrix,
          modified: new Date(_1904 + trak.tkhd.modification_time * 1e3),
          movie_duration: trak.tkhd.duration,
          movie_timescale: movie.timescale,
          name: trak.mdia.hdlr.name,
          nb_samples: trak.samples.length,
          references: [],
          track_height: trak.tkhd.height / 65536,
          track_width: trak.tkhd.width / 65536,
          volume: trak.tkhd.volume
        };
        movie.tracks.push(track);
        if (trak.tref) for (let j = 0; j < trak.tref.references.length; j++) track.references.push({
          type: trak.tref.references[j].type,
          track_ids: trak.tref.references[j].track_ids
        });
        if (trak.edts !== void 0 && trak.edts.elst !== void 0) track.edits = trak.edts.elst.entries;
        if (sample_desc instanceof AudioSampleEntry) {
          track.type = "audio";
          movie.audioTracks.push(track);
          track.audio = {
            sample_rate: sample_desc.getSampleRate(),
            channel_count: sample_desc.getChannelCount(),
            sample_size: sample_desc.getSampleSize()
          };
        } else if (sample_desc instanceof VisualSampleEntry) {
          track.type = "video";
          movie.videoTracks.push(track);
          track.video = {
            width: sample_desc.getWidth(),
            height: sample_desc.getHeight()
          };
        } else if (sample_desc instanceof SubtitleSampleEntry) {
          track.type = "subtitles";
          movie.subtitleTracks.push(track);
        } else if (sample_desc instanceof HintSampleEntry) {
          track.type = "metadata";
          movie.hintTracks.push(track);
        } else if (sample_desc instanceof MetadataSampleEntry) {
          track.type = "metadata";
          movie.metadataTracks.push(track);
        } else {
          track.type = "metadata";
          movie.otherTracks.push(track);
        }
      }
      if (movie.videoTracks && movie.videoTracks.length > 0) movie.mime += 'video/mp4; codecs="';
      else if (movie.audioTracks && movie.audioTracks.length > 0) movie.mime += 'audio/mp4; codecs="';
      else movie.mime += 'application/mp4; codecs="';
      for (let i = 0; i < movie.tracks.length; i++) {
        if (i !== 0) movie.mime += ",";
        movie.mime += movie.tracks[i].codec;
      }
      movie.mime += '"; profiles="';
      movie.mime += this.ftyp.compatible_brands.join();
      movie.mime += '"';
      return movie;
    }
    setNextSeekPositionFromSample(sample) {
      if (!sample) return;
      if (this.nextSeekPosition) this.nextSeekPosition = Math.min(sample.offset + sample.alreadyRead, this.nextSeekPosition);
      else this.nextSeekPosition = sample.offset + sample.alreadyRead;
    }
    processSamples(last) {
      if (!this.sampleProcessingStarted) return;
      if (this.isFragmentationInitialized && this.onSegment !== void 0) {
        const consumedTracks = /* @__PURE__ */ new Set();
        while (consumedTracks.size < this.fragmentedTracks.length && this.fragmentedTracks.some((track) => track.trak.nextSample < track.trak.samples.length) && this.sampleProcessingStarted) for (const fragTrak of this.fragmentedTracks) {
          const trak = fragTrak.trak;
          if (!consumedTracks.has(fragTrak.id)) {
            const sample = trak.nextSample < trak.samples.length ? this.getSample(trak, trak.nextSample) : void 0;
            if (!sample) {
              this.setNextSeekPositionFromSample(trak.samples[trak.nextSample]);
              consumedTracks.add(fragTrak.id);
              continue;
            }
            fragTrak.state.accumulatedSize += sample.size;
            const sampleNum = trak.nextSample + 1;
            const isFragmentOverdue = sampleNum - fragTrak.state.lastFragmentSampleNumber > fragTrak.nb_samples_per_fragment;
            const isSegmentOverdue = sampleNum - fragTrak.state.lastSegmentSampleNumber > fragTrak.nb_samples;
            let isFragmentBoundary = isFragmentOverdue || sampleNum % fragTrak.nb_samples_per_fragment === 0;
            let isSegmentBoundary = isSegmentOverdue || sampleNum % fragTrak.nb_samples === 0;
            let isSizeBoundary = fragTrak.state.accumulatedSize >= fragTrak.size_per_segment;
            const isRAP = !fragTrak.rapAlignement || sample.is_sync;
            const isFlush = last || trak.nextSample + 1 >= trak.samples.length;
            if (isFlush && !isRAP) Log.warn("ISOFile", "Flushing track #" + fragTrak.id + " at sample #" + trak.nextSample + " which is not a RAP, this may lead to playback issues");
            isFragmentBoundary = isFragmentBoundary && isRAP;
            isSegmentBoundary = isSegmentBoundary && isRAP;
            isSizeBoundary = isSizeBoundary && isRAP;
            if (isFragmentBoundary || isSizeBoundary || isFlush) {
              if (isFragmentOverdue) Log.warn("ISOFile", "Fragment on track #" + fragTrak.id + " is overdue, creating it with samples [" + fragTrak.state.lastFragmentSampleNumber + ", " + trak.nextSample + "]");
              else Log.debug("ISOFile", "Creating media fragment on track #" + fragTrak.id + " for samples [" + fragTrak.state.lastFragmentSampleNumber + ", " + trak.nextSample + "]");
              const result = this.createFragment(fragTrak.id, fragTrak.state.lastFragmentSampleNumber, trak.nextSample, fragTrak.segmentStream);
              if (result) {
                fragTrak.segmentStream = result;
                fragTrak.state.lastFragmentSampleNumber = trak.nextSample + 1;
              } else {
                consumedTracks.add(fragTrak.id);
                continue;
              }
            }
            if (isSegmentBoundary || isSizeBoundary || isFlush) {
              if (isSegmentOverdue) Log.warn("ISOFile", "Segment on track #" + fragTrak.id + " is overdue, sending it with samples [" + Math.max(0, trak.nextSample - fragTrak.nb_samples) + ", " + (trak.nextSample - 1) + "]");
              else Log.info("ISOFile", "Sending fragmented data on track #" + fragTrak.id + " for samples [" + Math.max(0, trak.nextSample - fragTrak.nb_samples) + ", " + (trak.nextSample - 1) + "]");
              Log.info("ISOFile", "Sample data size in memory: " + this.getAllocatedSampleDataSize());
              if (this.onSegment) this.onSegment(fragTrak.id, fragTrak.user, fragTrak.segmentStream.buffer, trak.nextSample + 1, last || trak.nextSample + 1 >= trak.samples.length);
              fragTrak.segmentStream = void 0;
              fragTrak.state.accumulatedSize = 0;
              fragTrak.state.lastSegmentSampleNumber = trak.nextSample + 1;
            }
            trak.nextSample++;
          }
        }
      }
      if (this.onSamples !== void 0) for (let i = 0; i < this.extractedTracks.length; i++) {
        const extractTrak = this.extractedTracks[i];
        const trak = extractTrak.trak;
        while (trak.nextSample < trak.samples.length && this.sampleProcessingStarted) {
          Log.debug("ISOFile", "Exporting on track #" + extractTrak.id + " sample #" + trak.nextSample);
          const sample = this.getSample(trak, trak.nextSample);
          if (sample) {
            trak.nextSample++;
            extractTrak.samples.push(sample);
          } else {
            this.setNextSeekPositionFromSample(trak.samples[trak.nextSample]);
            break;
          }
          if (trak.nextSample % extractTrak.nb_samples === 0 || trak.nextSample >= trak.samples.length) {
            Log.debug("ISOFile", "Sending samples on track #" + extractTrak.id + " for sample " + trak.nextSample);
            if (this.onSamples) this.onSamples(extractTrak.id, extractTrak.user, extractTrak.samples);
            extractTrak.samples = [];
            if (extractTrak !== this.extractedTracks[i]) break;
          }
        }
      }
    }
    getBox(type) {
      const result = this.getBoxes(type, true);
      return result.length ? result[0] : void 0;
    }
    getBoxes(type, returnEarly) {
      const result = [];
      const sweep = (root) => {
        if (root instanceof Box && root.type && root.type === type) result.push(root);
        const inner = [];
        if (root["boxes"]) inner.push(...root.boxes);
        if (root["entries"]) inner.push(...root["entries"]);
        if (root["item_infos"]) inner.push(...root["item_infos"]);
        if (root["references"]) inner.push(...root["references"]);
        for (const box2 of inner) {
          if (result.length && returnEarly) return;
          sweep(box2);
        }
      };
      sweep(this);
      return result;
    }
    getTrackSamplesInfo(track_id) {
      const track = this.getTrackById(track_id);
      if (track) return track.samples;
    }
    getTrackSample(track_id, number) {
      const track = this.getTrackById(track_id);
      return this.getSample(track, number);
    }
    releaseUsedSamples(id, sampleNum) {
      let size = 0;
      const trak = this.getTrackById(id);
      if (!trak.lastValidSample) trak.lastValidSample = 0;
      for (let i = trak.lastValidSample; i < sampleNum; i++) size += this.releaseSample(trak, i);
      Log.info("ISOFile", "Track #" + id + " released samples up to " + sampleNum + " (released size: " + size + ", remaining: " + this.samplesDataSize + ")");
      trak.lastValidSample = sampleNum;
    }
    start() {
      this.sampleProcessingStarted = true;
      this.processSamples(false);
    }
    stop() {
      this.sampleProcessingStarted = false;
    }
    flush() {
      Log.info("ISOFile", "Flushing remaining samples");
      this.updateSampleLists();
      this.processSamples(true);
      this.stream.cleanBuffers();
      this.stream.logBufferLevel(true);
    }
    seekTrack(time, useRap, trak) {
      let rap_seek_sample_num = 0;
      let seek_sample_num = 0;
      let timescale;
      if (trak.samples.length === 0) {
        Log.info("ISOFile", "No sample in track, cannot seek! Using time " + Log.getDurationString(0, 1) + " and offset: 0");
        return {
          offset: 0,
          time: 0
        };
      }
      for (let j = 0; j < trak.samples.length; j++) {
        const sample = trak.samples[j];
        if (j === 0) {
          seek_sample_num = 0;
          timescale = sample.timescale;
        } else if (sample.cts > time * sample.timescale) {
          seek_sample_num = j - 1;
          break;
        }
        if (useRap && sample.is_sync) rap_seek_sample_num = j;
      }
      if (useRap) seek_sample_num = rap_seek_sample_num;
      time = trak.samples[seek_sample_num].cts;
      trak.nextSample = seek_sample_num;
      this.resetFragmentedTrackStateAfterSeek(trak, seek_sample_num);
      this.resetExtractedTrackStateAfterSeek(trak);
      while (trak.samples[seek_sample_num].alreadyRead === trak.samples[seek_sample_num].size) {
        if (!trak.samples[seek_sample_num + 1]) break;
        seek_sample_num++;
      }
      const seek_offset = trak.samples[seek_sample_num].offset + trak.samples[seek_sample_num].alreadyRead;
      Log.info("ISOFile", "Seeking to " + (useRap ? "RAP" : "") + " sample #" + trak.nextSample + " on track " + trak.tkhd.track_id + ", time " + Log.getDurationString(time, timescale) + " and offset: " + seek_offset);
      return {
        offset: seek_offset,
        time: time / timescale
      };
    }
    resetFragmentedTrackStateAfterSeek(trak, seekSampleNumber) {
      const fragTrack = this.fragmentedTracks.find((t) => t.trak === trak);
      if (!fragTrack) return;
      fragTrack.state.lastFragmentSampleNumber = seekSampleNumber;
      fragTrack.state.lastSegmentSampleNumber = seekSampleNumber;
      fragTrack.state.accumulatedSize = 0;
      fragTrack.segmentStream = void 0;
    }
    resetExtractedTrackStateAfterSeek(trak) {
      const extractTrack = this.extractedTracks.find((t) => t.trak === trak);
      if (!extractTrack) return;
      extractTrack.samples = [];
    }
    getTrackDuration(trak) {
      if (!trak.samples) return Infinity;
      const sample = trak.samples[trak.samples.length - 1];
      return (sample.cts + sample.duration) / sample.timescale;
    }
    seek(time, useRap) {
      const moov = this.moov;
      let seek_info = {
        offset: Infinity,
        time: Infinity
      };
      if (!this.moov) throw new Error("Cannot seek: moov not received!");
      else {
        for (let i = 0; i < moov.traks.length; i++) {
          const trak = moov.traks[i];
          if (time > this.getTrackDuration(trak)) continue;
          const trak_seek_info = this.seekTrack(time, useRap, trak);
          if (trak_seek_info.offset < seek_info.offset) seek_info.offset = trak_seek_info.offset;
          if (trak_seek_info.time < seek_info.time) seek_info.time = trak_seek_info.time;
        }
        Log.info("ISOFile", "Seeking at time " + Log.getDurationString(seek_info.time, 1) + " needs a buffer with a fileStart position of " + seek_info.offset);
        if (seek_info.offset === Infinity) seek_info = {
          offset: this.nextParsePosition,
          time: 0
        };
        else seek_info.offset = this.stream.getEndFilePositionAfter(seek_info.offset);
        Log.info("ISOFile", "Adjusted seek position (after checking data already in buffer): " + seek_info.offset);
        return seek_info;
      }
    }
    equal(b) {
      let box_index = 0;
      while (box_index < this.boxes.length && box_index < b.boxes.length) {
        const a_box = this.boxes[box_index];
        const b_box = b.boxes[box_index];
        if (!boxEqual(a_box, b_box)) return false;
        box_index++;
      }
      return true;
    }
    /**
    * Rewrite the entire file
    * @bundle isofile-write.js
    */
    write(outstream) {
      for (let i = 0; i < this.boxes.length; i++) this.boxes[i].write(outstream);
    }
    /** @bundle isofile-write.js */
    createFragment(track_id, sampleStart, sampleEnd, existingStream) {
      if (sampleEnd < sampleStart) {
        Log.warn("ISOFile", `Skipping fragment creation on track #${track_id}: invalid sample range [${sampleStart}, ${sampleEnd}]`);
        return existingStream || new DataStream();
      }
      const samples = [];
      for (let i = sampleStart; i <= sampleEnd; i++) {
        const trak = this.getTrackById(track_id);
        const sample = this.getSample(trak, i);
        if (!sample) {
          this.setNextSeekPositionFromSample(trak.samples[i]);
          return;
        }
        samples.push(sample);
      }
      const stream = existingStream || new DataStream();
      const moof = this.createMoof(samples);
      moof.write(stream);
      moof.trafs[0].truns[0].data_offset = moof.size + 8;
      Log.debug("MP4Box", "Adjusting data_offset with new value " + moof.trafs[0].truns[0].data_offset);
      stream.adjustUint32(moof.trafs[0].truns[0].data_offset_position, moof.trafs[0].truns[0].data_offset);
      const mdat = new mdatBox();
      mdat.stream = new MultiBufferStream();
      let offset = 0;
      for (const sample of samples) if (sample.data) {
        const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(sample.data.buffer, offset);
        mdat.stream.insertBuffer(mp4Buffer);
        offset += sample.data.byteLength;
      }
      mdat.write(stream);
      return stream;
    }
    /**
    * Modify the file and create the initialization segment
    * @bundle isofile-write.js
    */
    static writeInitializationSegment(ftyp, moov, total_duration, normalizeAudioSampleEntryTrackIds) {
      Log.debug("ISOFile", "Generating initialization segment");
      const stream = new DataStream();
      ftyp.write(stream);
      const restoreCallbacks = ISOFile2.normalizeAudioSampleEntriesForMSEFragmentedInit(moov.traks, normalizeAudioSampleEntryTrackIds);
      try {
        const mvex = moov.addBox(new mvexBox());
        if (total_duration) {
          const mehd = mvex.addBox(new mehdBox());
          mehd.fragment_duration = total_duration;
        }
        for (let i = 0; i < moov.traks.length; i++) {
          const trex = mvex.addBox(new trexBox());
          trex.track_id = moov.traks[i].tkhd.track_id;
          trex.default_sample_description_index = 1;
          trex.default_sample_duration = moov.traks[i].samples[0]?.duration ?? 0;
          trex.default_sample_size = 0;
          trex.default_sample_flags = 65536;
        }
        moov.write(stream);
      } finally {
        for (let i = restoreCallbacks.length - 1; i >= 0; i--) restoreCallbacks[i]();
      }
      return stream.buffer;
    }
    /** @bundle isofile-write.js */
    save(name) {
      const stream = new DataStream();
      stream.isofile = this;
      this.write(stream);
      return stream.save(name);
    }
    /** @bundle isofile-write.js */
    getBuffer() {
      const stream = new DataStream();
      stream.isofile = this;
      this.write(stream);
      return stream;
    }
    /** @bundle isofile-write.js */
    static normalizeAudioSampleEntriesForMSEFragmentedInit(traks, normalizeAudioSampleEntryTrackIds) {
      const restoreCallbacks = [];
      for (const trak of traks) {
        if (!normalizeAudioSampleEntryTrackIds?.has(trak.tkhd.track_id)) continue;
        for (const sampleEntry of trak.mdia.minf.stbl.stsd?.entries ?? []) {
          if (!(sampleEntry instanceof mp4aSampleEntry)) continue;
          const esds = sampleEntry.wave?.esds;
          if (sampleEntry.esds || !esds) continue;
          const previousEsds = sampleEntry.esds;
          const previousWave = sampleEntry.wave;
          const previousBoxes = sampleEntry.boxes;
          restoreCallbacks.push(() => {
            sampleEntry.esds = previousEsds;
            sampleEntry.wave = previousWave;
            sampleEntry.boxes = previousBoxes;
          });
          const boxesWithoutWave = Array.isArray(sampleEntry.boxes) ? sampleEntry.boxes.filter((box2) => box2?.type !== "wave" && box2?.type !== "esds") : [];
          sampleEntry.esds = esds;
          sampleEntry.boxes = [...boxesWithoutWave, esds];
          sampleEntry.wave = void 0;
        }
      }
      return restoreCallbacks;
    }
    initializeSegmentation(mode) {
      if (!this.onSegment) Log.warn("MP4Box", "No segmentation callback set!");
      if (mode !== void 0 && mode !== "combined" && mode !== "per-track") throw new Error(`Invalid segmentation mode: ${mode}`);
      if (!this.isFragmentationInitialized) {
        this.isFragmentationInitialized = true;
        this.resetTables();
      }
      const tracksToInitialize = [];
      for (const fragmentedTrack of this.fragmentedTracks) {
        const trak = this.getTrackById(fragmentedTrack.id);
        if (!trak) {
          Log.warn("ISOFile", `Track with id ${fragmentedTrack.id} not found, skipping fragmentation initialization`);
          continue;
        }
        tracksToInitialize.push({
          id: fragmentedTrack.id,
          user: fragmentedTrack.user,
          trak
        });
      }
      const fragmentDuration = this.moov?.mvex?.mehd?.fragment_duration;
      const normalizeAudioSampleEntryTrackIds = new Set(this.fragmentedTracks.filter((track) => track.normalizeAudioSampleEntriesForMSE !== false).map((track) => track.id));
      if (mode === "per-track") return tracksToInitialize.map(({ id, user, trak }) => {
        const moov2 = new moovBox();
        moov2.addBox(this.moov.mvhd);
        moov2.addBox(trak);
        return {
          id,
          user,
          buffer: ISOFile2.writeInitializationSegment(this.ftyp, moov2, fragmentDuration, normalizeAudioSampleEntryTrackIds)
        };
      });
      const moov = new moovBox();
      moov.addBox(this.moov.mvhd);
      for (const track of tracksToInitialize) moov.addBox(track.trak);
      return {
        tracks: tracksToInitialize.map(({ id, user }) => ({
          id,
          user
        })),
        buffer: ISOFile2.writeInitializationSegment(this.ftyp, moov, fragmentDuration, normalizeAudioSampleEntryTrackIds)
      };
    }
    /**
    * Resets all sample tables
    * @bundle isofile-sample-processing.js
    */
    resetTables() {
      this.initial_duration = this.moov.mvhd.duration;
      this.moov.mvhd.duration = 0;
      for (let i = 0; i < this.moov.traks.length; i++) {
        const trak = this.moov.traks[i];
        trak.tkhd.duration = 0;
        trak.mdia.mdhd.duration = 0;
        const stco = trak.mdia.minf.stbl.stco || trak.mdia.minf.stbl.co64;
        stco.chunk_offsets = [];
        const stsc = trak.mdia.minf.stbl.stsc;
        stsc.first_chunk = [];
        stsc.samples_per_chunk = [];
        stsc.sample_description_index = [];
        const stsz = trak.mdia.minf.stbl.stsz || trak.mdia.minf.stbl.stz2;
        stsz.sample_sizes = [];
        const stts = trak.mdia.minf.stbl.stts;
        stts.sample_counts = [];
        stts.sample_deltas = [];
        const ctts = trak.mdia.minf.stbl.ctts;
        if (ctts) {
          ctts.sample_counts = [];
          ctts.sample_offsets = [];
        }
        const stss = trak.mdia.minf.stbl.stss;
        const k = trak.mdia.minf.stbl.boxes.indexOf(stss);
        if (k !== -1) trak.mdia.minf.stbl.boxes[k] = void 0;
      }
    }
    /** @bundle isofile-sample-processing.js */
    static initSampleGroups(trak, traf, sbgps, trak_sgpds, traf_sgpds) {
      if (traf) traf.sample_groups_info = [];
      if (!trak.sample_groups_info) trak.sample_groups_info = [];
      for (let k = 0; k < sbgps.length; k++) {
        const sample_group_key = sbgps[k].grouping_type + "/" + sbgps[k].grouping_type_parameter;
        const sample_group_info = new SampleGroupInfo(sbgps[k].grouping_type, sbgps[k].grouping_type_parameter, sbgps[k]);
        if (traf) traf.sample_groups_info[sample_group_key] = sample_group_info;
        if (!trak.sample_groups_info[sample_group_key]) trak.sample_groups_info[sample_group_key] = sample_group_info;
        for (let l = 0; l < trak_sgpds.length; l++) if (trak_sgpds[l].grouping_type === sbgps[k].grouping_type) {
          sample_group_info.description = trak_sgpds[l];
          sample_group_info.description.used = true;
        }
        if (traf_sgpds) {
          for (let l = 0; l < traf_sgpds.length; l++) if (traf_sgpds[l].grouping_type === sbgps[k].grouping_type) {
            sample_group_info.fragment_description = traf_sgpds[l];
            sample_group_info.fragment_description.used = true;
            sample_group_info.is_fragment = true;
          }
        }
      }
      if (!traf) {
        for (let k = 0; k < trak_sgpds.length; k++) if (!trak_sgpds[k].used && trak_sgpds[k].version >= 2) {
          const sample_group_key = trak_sgpds[k].grouping_type + "/0";
          const sample_group_info = new SampleGroupInfo(trak_sgpds[k].grouping_type, 0);
          if (!trak.sample_groups_info[sample_group_key]) trak.sample_groups_info[sample_group_key] = sample_group_info;
        }
      } else if (traf_sgpds) {
        for (let k = 0; k < traf_sgpds.length; k++) if (!traf_sgpds[k].used && traf_sgpds[k].version >= 2) {
          const sample_group_key = traf_sgpds[k].grouping_type + "/0";
          const sample_group_info = new SampleGroupInfo(traf_sgpds[k].grouping_type, 0);
          sample_group_info.is_fragment = true;
          if (!traf.sample_groups_info[sample_group_key]) traf.sample_groups_info[sample_group_key] = sample_group_info;
        }
      }
    }
    /** @bundle isofile-sample-processing.js */
    static setSampleGroupProperties(trak, sample, sample_number, sample_groups_info) {
      sample.sample_groups = [];
      for (const k in sample_groups_info) {
        sample.sample_groups[k] = {
          grouping_type: sample_groups_info[k].grouping_type,
          grouping_type_parameter: sample_groups_info[k].grouping_type_parameter
        };
        if (sample_number >= sample_groups_info[k].last_sample_in_run) {
          if (sample_groups_info[k].last_sample_in_run < 0) sample_groups_info[k].last_sample_in_run = 0;
          sample_groups_info[k].entry_index++;
          if (sample_groups_info[k].entry_index <= sample_groups_info[k].sbgp.entries.length - 1) sample_groups_info[k].last_sample_in_run += sample_groups_info[k].sbgp.entries[sample_groups_info[k].entry_index].sample_count;
        }
        if (sample_groups_info[k].entry_index <= sample_groups_info[k].sbgp.entries.length - 1) sample.sample_groups[k].group_description_index = sample_groups_info[k].sbgp.entries[sample_groups_info[k].entry_index].group_description_index;
        else sample.sample_groups[k].group_description_index = -1;
        if (sample.sample_groups[k].group_description_index !== 0) {
          let description;
          if (sample_groups_info[k].fragment_description) description = sample_groups_info[k].fragment_description;
          else description = sample_groups_info[k].description;
          if (sample.sample_groups[k].group_description_index > 0) {
            let index;
            if (sample.sample_groups[k].group_description_index > 65535) index = (sample.sample_groups[k].group_description_index >> 16) - 1;
            else index = sample.sample_groups[k].group_description_index - 1;
            if (description && index >= 0) sample.sample_groups[k].description = description.entries[index];
          } else if (description && description.version >= 2) {
            if (description.default_group_description_index > 0) sample.sample_groups[k].description = description.entries[description.default_group_description_index - 1];
          }
        }
      }
    }
    /** @bundle isofile-sample-processing.js */
    static process_sdtp(sdtp, sample, number) {
      if (!sample) return;
      if (sdtp) {
        sample.is_leading = sdtp.is_leading[number];
        sample.depends_on = sdtp.sample_depends_on[number];
        sample.is_depended_on = sdtp.sample_is_depended_on[number];
        sample.has_redundancy = sdtp.sample_has_redundancy[number];
      } else {
        sample.is_leading = 0;
        sample.depends_on = 0;
        sample.is_depended_on = 0;
        sample.has_redundancy = 0;
      }
    }
    buildSampleLists() {
      for (let i = 0; i < this.moov.traks.length; i++) this.buildTrakSampleLists(this.moov.traks[i]);
    }
    buildTrakSampleLists(trak) {
      let j;
      let chunk_run_index;
      let chunk_index;
      let last_chunk_in_run;
      let offset_in_chunk;
      let last_sample_in_chunk;
      trak.samples = [];
      trak.samples_duration = 0;
      trak.samples_size = 0;
      const stco = trak.mdia.minf.stbl.stco || trak.mdia.minf.stbl.co64;
      const stsc = trak.mdia.minf.stbl.stsc;
      const stsz = trak.mdia.minf.stbl.stsz || trak.mdia.minf.stbl.stz2;
      const stts = trak.mdia.minf.stbl.stts;
      const ctts = trak.mdia.minf.stbl.ctts;
      const stss = trak.mdia.minf.stbl.stss;
      const stsd = trak.mdia.minf.stbl.stsd;
      const subs = trak.mdia.minf.stbl.subs;
      const stdp = trak.mdia.minf.stbl.stdp;
      const sbgps = trak.mdia.minf.stbl.sbgps;
      const sgpds = trak.mdia.minf.stbl.sgpds;
      let last_sample_in_stts_run = -1;
      let stts_run_index = -1;
      let last_sample_in_ctts_run = -1;
      let ctts_run_index = -1;
      let last_stss_index = 0;
      let subs_entry_index = 0;
      let last_subs_sample_index = 0;
      ISOFile2.initSampleGroups(trak, void 0, sbgps, sgpds);
      if (typeof stsz === "undefined") return;
      for (j = 0; j < stsz.sample_sizes.length; j++) {
        const sample = {
          number: j,
          track_id: trak.tkhd.track_id,
          timescale: trak.mdia.mdhd.timescale,
          alreadyRead: 0,
          size: stsz.sample_sizes[j]
        };
        trak.samples[j] = sample;
        trak.samples_size += sample.size;
        if (j === 0) {
          chunk_index = 1;
          chunk_run_index = 0;
          sample.chunk_index = chunk_index;
          sample.chunk_run_index = chunk_run_index;
          last_sample_in_chunk = stsc.samples_per_chunk[chunk_run_index];
          offset_in_chunk = 0;
          if (chunk_run_index + 1 < stsc.first_chunk.length) last_chunk_in_run = stsc.first_chunk[chunk_run_index + 1] - 1;
          else last_chunk_in_run = Infinity;
        } else if (j < last_sample_in_chunk) {
          sample.chunk_index = chunk_index;
          sample.chunk_run_index = chunk_run_index;
        } else {
          chunk_index++;
          sample.chunk_index = chunk_index;
          offset_in_chunk = 0;
          if (chunk_index <= last_chunk_in_run) {
          } else {
            chunk_run_index++;
            if (chunk_run_index + 1 < stsc.first_chunk.length) last_chunk_in_run = stsc.first_chunk[chunk_run_index + 1] - 1;
            else last_chunk_in_run = Infinity;
          }
          sample.chunk_run_index = chunk_run_index;
          last_sample_in_chunk += stsc.samples_per_chunk[chunk_run_index];
        }
        sample.description_index = stsc.sample_description_index[sample.chunk_run_index] - 1;
        sample.description = stsd.entries[sample.description_index];
        sample.offset = stco.chunk_offsets[sample.chunk_index - 1] + offset_in_chunk;
        offset_in_chunk += sample.size;
        if (j > last_sample_in_stts_run) {
          stts_run_index++;
          if (last_sample_in_stts_run < 0) last_sample_in_stts_run = 0;
          last_sample_in_stts_run += stts.sample_counts[stts_run_index];
        }
        if (j > 0) {
          trak.samples[j - 1].duration = stts.sample_deltas[stts_run_index];
          trak.samples_duration += trak.samples[j - 1].duration;
          sample.dts = trak.samples[j - 1].dts + trak.samples[j - 1].duration;
        } else sample.dts = 0;
        if (ctts) {
          if (j >= last_sample_in_ctts_run) {
            ctts_run_index++;
            if (last_sample_in_ctts_run < 0) last_sample_in_ctts_run = 0;
            last_sample_in_ctts_run += ctts.sample_counts[ctts_run_index];
          }
          sample.cts = trak.samples[j].dts + ctts.sample_offsets[ctts_run_index];
        } else sample.cts = sample.dts;
        if (stss) {
          if (j === stss.sample_numbers[last_stss_index] - 1) {
            sample.is_sync = true;
            last_stss_index++;
          } else {
            sample.is_sync = false;
            sample.degradation_priority = 0;
          }
          if (subs) {
            if (subs.entries[subs_entry_index].sample_delta + last_subs_sample_index === j + 1) {
              sample.subsamples = subs.entries[subs_entry_index].subsamples;
              last_subs_sample_index += subs.entries[subs_entry_index].sample_delta;
              subs_entry_index++;
            }
          }
        } else sample.is_sync = true;
        ISOFile2.process_sdtp(trak.mdia.minf.stbl.sdtp, sample, sample.number);
        if (stdp) sample.degradation_priority = stdp.priority[j];
        else sample.degradation_priority = 0;
        if (subs) {
          if (subs.entries[subs_entry_index].sample_delta + last_subs_sample_index === j) {
            sample.subsamples = subs.entries[subs_entry_index].subsamples;
            last_subs_sample_index += subs.entries[subs_entry_index].sample_delta;
          }
        }
        if (sbgps.length > 0 || sgpds.length > 0) ISOFile2.setSampleGroupProperties(trak, sample, j, trak.sample_groups_info);
      }
      if (j > 0) {
        trak.samples[j - 1].duration = Math.max(trak.mdia.mdhd.duration - trak.samples[j - 1].dts, 0);
        trak.samples_duration += trak.samples[j - 1].duration;
      }
    }
    /**
    * Update sample list when new 'moof' boxes are received
    * @bundle isofile-sample-processing.js
    */
    updateSampleLists() {
      let default_sample_description_index;
      let default_sample_duration;
      let default_sample_size;
      let default_sample_flags;
      let last_run_position;
      if (this.moov === void 0) return;
      while (this.lastMoofIndex < this.moofs.length) {
        const box2 = this.moofs[this.lastMoofIndex];
        this.lastMoofIndex++;
        if (box2.type === "moof") {
          const moof = box2;
          for (let i = 0; i < moof.trafs.length; i++) {
            const traf = moof.trafs[i];
            const trak = this.getTrackById(traf.tfhd.track_id);
            const trex = this.getTrexById(traf.tfhd.track_id);
            if (traf.tfhd.flags & 2) default_sample_description_index = traf.tfhd.default_sample_description_index;
            else default_sample_description_index = trex ? trex.default_sample_description_index : 1;
            if (traf.tfhd.flags & 8) default_sample_duration = traf.tfhd.default_sample_duration;
            else default_sample_duration = trex ? trex.default_sample_duration : 0;
            if (traf.tfhd.flags & 16) default_sample_size = traf.tfhd.default_sample_size;
            else default_sample_size = trex ? trex.default_sample_size : 0;
            if (traf.tfhd.flags & 32) default_sample_flags = traf.tfhd.default_sample_flags;
            else default_sample_flags = trex ? trex.default_sample_flags : 0;
            traf.sample_number = 0;
            if (traf.sbgps.length > 0) ISOFile2.initSampleGroups(trak, traf, traf.sbgps, trak.mdia.minf.stbl.sgpds, traf.sgpds);
            for (let j = 0; j < traf.truns.length; j++) {
              const trun = traf.truns[j];
              for (let k = 0; k < trun.sample_count; k++) {
                const description_index = default_sample_description_index - 1;
                let sample_flags = default_sample_flags;
                if (trun.flags & 1024) sample_flags = trun.sample_flags[k];
                else if (k === 0 && trun.flags & 4) sample_flags = trun.first_sample_flags;
                let size = default_sample_size;
                if (trun.flags & 512) size = trun.sample_size[k];
                trak.samples_size += size;
                let duration = default_sample_duration;
                if (trun.flags & 256) duration = trun.sample_duration[k];
                trak.samples_duration += duration;
                let dts;
                if (trak.first_traf_merged || k > 0) dts = trak.samples[trak.samples.length - 1].dts + trak.samples[trak.samples.length - 1].duration;
                else {
                  if (traf.tfdt) dts = traf.tfdt.baseMediaDecodeTime;
                  else dts = 0;
                  trak.first_traf_merged = true;
                }
                let cts = dts;
                if (trun.flags & 2048) cts = dts + trun.sample_composition_time_offset[k];
                const bdop = traf.tfhd.flags & 1 ? true : false;
                const dbim = traf.tfhd.flags & 131072 ? true : false;
                const dop = trun.flags & 1 ? true : false;
                let bdo = 0;
                if (!bdop) if (!dbim) if (j === 0) bdo = moof.start;
                else bdo = last_run_position;
                else bdo = moof.start;
                else bdo = traf.tfhd.base_data_offset;
                let offset;
                if (j === 0 && k === 0) if (dop) offset = bdo + trun.data_offset;
                else offset = bdo;
                else offset = last_run_position;
                last_run_position = offset + size;
                const number_in_traf = traf.sample_number;
                traf.sample_number++;
                const sample = {
                  cts,
                  description_index,
                  description: trak.mdia.minf.stbl.stsd.entries[description_index],
                  dts,
                  duration,
                  moof_number: this.lastMoofIndex,
                  number_in_traf,
                  number: trak.samples.length,
                  offset,
                  size,
                  timescale: trak.mdia.mdhd.timescale,
                  track_id: trak.tkhd.track_id,
                  is_sync: sample_flags >> 16 & 1 ? false : true,
                  is_leading: sample_flags >> 26 & 3,
                  depends_on: sample_flags >> 24 & 3,
                  is_depended_on: sample_flags >> 22 & 3,
                  has_redundancy: sample_flags >> 20 & 3,
                  degradation_priority: sample_flags & 65535
                };
                traf.first_sample_index = trak.samples.length;
                trak.samples.push(sample);
                if (traf.sbgps.length > 0 || traf.sgpds.length > 0 || trak.mdia.minf.stbl.sbgps.length > 0 || trak.mdia.minf.stbl.sgpds.length > 0) ISOFile2.setSampleGroupProperties(trak, sample, sample.number_in_traf, traf.sample_groups_info);
              }
            }
            if (traf.subs) {
              trak.has_fragment_subsamples = true;
              let sample_index = traf.first_sample_index;
              for (let j = 0; j < traf.subs.entries.length; j++) {
                sample_index += traf.subs.entries[j].sample_delta;
                const sample = trak.samples[sample_index - 1];
                sample.subsamples = traf.subs.entries[j].subsamples;
              }
            }
          }
        }
      }
    }
    /**
    * Try to get sample data for a given sample:
    * returns null if not found
    * returns the same sample if already requested
    *
    * @bundle isofile-sample-processing.js
    */
    getSample(trak, sampleNum) {
      const sample = trak.samples[sampleNum];
      if (!this.moov) return;
      if (!sample.data) {
        sample.data = new Uint8Array(sample.size);
        sample.alreadyRead = 0;
        this.samplesDataSize += sample.size;
        Log.debug("ISOFile", "Allocating sample #" + sampleNum + " on track #" + trak.tkhd.track_id + " of size " + sample.size + " (total: " + this.samplesDataSize + ")");
      } else if (sample.alreadyRead === sample.size) return sample;
      while (true) {
        let stream = this.stream;
        let index = stream.findPosition(true, sample.offset + sample.alreadyRead, false);
        let buffer;
        let fileStart;
        if (index > -1) {
          buffer = stream.buffers[index];
          fileStart = buffer.fileStart;
        } else for (const mdat of this.mdats) {
          if (!mdat.stream) {
            Log.debug("ISOFile", "mdat stream not yet fully read for #" + this.mdats.indexOf(mdat) + " mdat");
            continue;
          }
          index = mdat.stream.findPosition(true, sample.offset + sample.alreadyRead - mdat.start - mdat.hdr_size, false);
          if (index > -1) {
            stream = mdat.stream;
            buffer = mdat.stream.buffers[index];
            fileStart = mdat.start + mdat.hdr_size + buffer.fileStart;
            break;
          }
        }
        if (buffer) {
          const lengthAfterStart = buffer.byteLength - (sample.offset + sample.alreadyRead - fileStart);
          if (sample.size - sample.alreadyRead <= lengthAfterStart) {
            Log.debug("ISOFile", "Getting sample #" + sampleNum + " data (alreadyRead: " + sample.alreadyRead + " offset: " + (sample.offset + sample.alreadyRead - fileStart) + " read size: " + (sample.size - sample.alreadyRead) + " full size: " + sample.size + ")");
            DataStream.memcpy(sample.data.buffer, sample.alreadyRead, buffer, sample.offset + sample.alreadyRead - fileStart, sample.size - sample.alreadyRead);
            buffer.usedBytes += sample.size - sample.alreadyRead;
            stream.logBufferLevel();
            sample.alreadyRead = sample.size;
            return sample;
          } else {
            if (lengthAfterStart === 0) return;
            Log.debug("ISOFile", "Getting sample #" + sampleNum + " partial data (alreadyRead: " + sample.alreadyRead + " offset: " + (sample.offset + sample.alreadyRead - fileStart) + " read size: " + lengthAfterStart + " full size: " + sample.size + ")");
            DataStream.memcpy(sample.data.buffer, sample.alreadyRead, buffer, sample.offset + sample.alreadyRead - fileStart, lengthAfterStart);
            sample.alreadyRead += lengthAfterStart;
            buffer.usedBytes += lengthAfterStart;
            stream.logBufferLevel();
          }
        } else return;
      }
    }
    /**
    * Release the memory used to store the data of the sample
    *
    * @bundle isofile-sample-processing.js
    */
    releaseSample(trak, sampleNum) {
      const sample = trak.samples[sampleNum];
      if (sample.data) {
        this.samplesDataSize -= sample.size;
        sample.data = void 0;
        sample.alreadyRead = 0;
        return sample.size;
      } else return 0;
    }
    /** @bundle isofile-sample-processing.js */
    getAllocatedSampleDataSize() {
      return this.samplesDataSize;
    }
    /**
    * Builds the MIME Type 'codecs' sub-parameters for the whole file
    *
    * @bundle isofile-sample-processing.js
    */
    getCodecs() {
      let codecs = "";
      for (let i = 0; i < this.moov.traks.length; i++) {
        const trak = this.moov.traks[i];
        if (i > 0) codecs += ",";
        codecs += trak.mdia.minf.stbl.stsd.entries[0].getCodec();
      }
      return codecs;
    }
    /**
    * Helper function
    *
    * @bundle isofile-sample-processing.js
    */
    getTrexById(id) {
      if (!this.moov || !this.moov.mvex) return;
      for (let i = 0; i < this.moov.mvex.trexs.length; i++) {
        const trex = this.moov.mvex.trexs[i];
        if (trex.track_id === id) return trex;
      }
    }
    /**
    * Helper function
    *
    * @bundle isofile-sample-processing.js
    */
    getTrackById(id) {
      if (!this.moov) return;
      for (let j = 0; j < this.moov.traks.length; j++) {
        const trak = this.moov.traks[j];
        if (trak.tkhd.track_id === id) return trak;
      }
    }
    /** @bundle isofile-item-processing.js */
    flattenItemInfo() {
      const items = this.items;
      const entity_groups = this.entity_groups;
      const meta = this.meta;
      if (!meta || !meta.hdlr || !meta.iinf) return;
      for (let i = 0; i < meta.iinf.item_infos.length; i++) {
        const id = meta.iinf.item_infos[i].item_ID;
        items[id] = {
          id,
          name: meta.iinf.item_infos[i].item_name,
          ref_to: [],
          content_type: meta.iinf.item_infos[i].content_type,
          content_encoding: meta.iinf.item_infos[i].content_encoding,
          item_uri_type: meta.iinf.item_infos[i].item_uri_type,
          type: meta.iinf.item_infos[i].item_type ? meta.iinf.item_infos[i].item_type : "mime",
          protection: meta.iinf.item_infos[i].item_protection_index > 0 ? meta.ipro.protections[meta.iinf.item_infos[i].item_protection_index - 1] : void 0
        };
      }
      if (meta.grpl) for (let i = 0; i < meta.grpl.boxes.length; i++) {
        const entityGroup = meta.grpl.boxes[i];
        entity_groups[entityGroup.group_id] = {
          id: entityGroup.group_id,
          entity_ids: entityGroup.entity_ids,
          type: entityGroup.type
        };
      }
      if (meta.iloc) for (let i = 0; i < meta.iloc.items.length; i++) {
        const itemloc = meta.iloc.items[i];
        const item = items[itemloc.item_ID];
        if (itemloc.data_reference_index !== 0) {
          Log.warn("Item storage with reference to other files: not supported");
          item.source = meta.dinf.boxes[itemloc.data_reference_index - 1];
        }
        item.extents = [];
        item.size = 0;
        for (let j = 0; j < itemloc.extents.length; j++) {
          item.extents[j] = {
            offset: itemloc.extents[j].extent_offset + itemloc.base_offset,
            length: itemloc.extents[j].extent_length,
            alreadyRead: 0
          };
          if (itemloc.construction_method === 1) item.extents[j].offset += meta.idat.start + meta.idat.hdr_size;
          item.size += item.extents[j].length;
        }
      }
      if (meta.pitm) {
        const id = meta.pitm.item_id;
        if (!items[id]) Log.warn("ISOFile", "Primary item_id #" + id + " does not exist in items");
        else items[id].primary = true;
      }
      if (meta.iref) for (let i = 0; i < meta.iref.references.length; i++) {
        const ref = meta.iref.references[i];
        for (let j = 0; j < ref.references.length; j++) items[ref.from_item_ID].ref_to.push({
          type: ref.type,
          id: ref.references[j]
        });
      }
      if (meta.iprp) for (let k = 0; k < meta.iprp.ipmas.length; k++) {
        const ipma = meta.iprp.ipmas[k];
        for (let i = 0; i < ipma.associations.length; i++) {
          const association = ipma.associations[i];
          const item = items[association.id] ?? entity_groups[association.id];
          if (item) {
            if (item.properties === void 0) item.properties = { boxes: [] };
            for (let j = 0; j < association.props.length; j++) {
              const propEntry = association.props[j];
              if (propEntry.property_index > 0 && propEntry.property_index - 1 < meta.iprp.ipco.boxes.length) {
                const propbox = meta.iprp.ipco.boxes[propEntry.property_index - 1];
                item.properties[propbox.type] = propbox;
                item.properties.boxes.push(propbox);
              }
            }
          }
        }
      }
    }
    /** @bundle isofile-item-processing.js */
    getItem(item_id) {
      if (!this.meta) return;
      const item = this.items[item_id];
      if (!item.data && item.size) {
        item.data = new Uint8Array(item.size);
        item.alreadyRead = 0;
        this.itemsDataSize += item.size;
        Log.debug("ISOFile", "Allocating item #" + item_id + " of size " + item.size + " (total: " + this.itemsDataSize + ")");
      } else if (item.alreadyRead === item.size) return item;
      for (let i = 0; i < item.extents.length; i++) {
        const extent = item.extents[i];
        if (extent.alreadyRead === extent.length) continue;
        else {
          const index = this.stream.findPosition(true, extent.offset + extent.alreadyRead, false);
          if (index > -1) {
            const buffer = this.stream.buffers[index];
            const lengthAfterStart = buffer.byteLength - (extent.offset + extent.alreadyRead - buffer.fileStart);
            if (extent.length - extent.alreadyRead <= lengthAfterStart) {
              Log.debug("ISOFile", "Getting item #" + item_id + " extent #" + i + " data (alreadyRead: " + extent.alreadyRead + " offset: " + (extent.offset + extent.alreadyRead - buffer.fileStart) + " read size: " + (extent.length - extent.alreadyRead) + " full extent size: " + extent.length + " full item size: " + item.size + ")");
              DataStream.memcpy(item.data.buffer, item.alreadyRead, buffer, extent.offset + extent.alreadyRead - buffer.fileStart, extent.length - extent.alreadyRead);
              if (!this.parsingMdat || this.discardMdatData) buffer.usedBytes += extent.length - extent.alreadyRead;
              this.stream.logBufferLevel();
              item.alreadyRead += extent.length - extent.alreadyRead;
              extent.alreadyRead = extent.length;
            } else {
              Log.debug("ISOFile", "Getting item #" + item_id + " extent #" + i + " partial data (alreadyRead: " + extent.alreadyRead + " offset: " + (extent.offset + extent.alreadyRead - buffer.fileStart) + " read size: " + lengthAfterStart + " full extent size: " + extent.length + " full item size: " + item.size + ")");
              DataStream.memcpy(item.data.buffer, item.alreadyRead, buffer, extent.offset + extent.alreadyRead - buffer.fileStart, lengthAfterStart);
              extent.alreadyRead += lengthAfterStart;
              item.alreadyRead += lengthAfterStart;
              if (!this.parsingMdat || this.discardMdatData) buffer.usedBytes += lengthAfterStart;
              this.stream.logBufferLevel();
              return;
            }
          } else return;
        }
      }
      if (item.alreadyRead === item.size) return item;
    }
    /**
    * Release the memory used to store the data of the item
    *
    * @bundle isofile-item-processing.js
    */
    releaseItem(item_id) {
      const item = this.items[item_id];
      if (item.data) {
        this.itemsDataSize -= item.size;
        item.data = void 0;
        item.alreadyRead = 0;
        for (let i = 0; i < item.extents.length; i++) {
          const extent = item.extents[i];
          extent.alreadyRead = 0;
        }
        return item.size;
      } else return 0;
    }
    /** @bundle isofile-item-processing.js */
    processItems(callback) {
      for (const i in this.items) {
        const item = this.items[i];
        this.getItem(item.id);
        if (callback && !item.sent) {
          callback(item);
          item.sent = true;
          item.data = void 0;
        }
      }
    }
    /** @bundle isofile-item-processing.js */
    hasItem(name) {
      for (const i in this.items) {
        const item = this.items[i];
        if (item.name === name) return item.id;
      }
      return -1;
    }
    /** @bundle isofile-item-processing.js */
    getMetaHandler() {
      if (this.meta) return this.meta.hdlr.handler;
    }
    /** @bundle isofile-item-processing.js */
    getPrimaryItem() {
      if (this.meta && this.meta.pitm) return this.getItem(this.meta.pitm.item_id);
    }
    /** @bundle isofile-item-processing.js */
    itemToFragmentedTrackFile({ itemId } = {}) {
      let item;
      if (itemId) item = this.getItem(itemId);
      else item = this.getPrimaryItem();
      if (!item) return;
      const file = new ISOFile2();
      file.discardMdatData = false;
      const trackOptions = {
        type: item.type,
        description_boxes: item.properties.boxes
      };
      if (item.properties.ispe) {
        trackOptions.width = item.properties.ispe.image_width;
        trackOptions.height = item.properties.ispe.image_height;
      }
      const trackId = file.addTrack(trackOptions);
      if (trackId) {
        file.addSample(trackId, item.data);
        return file;
      }
    }
    /** @bundle isofile-advanced-parsing.js */
    processIncompleteBox(ret) {
      if (ret.type === "mdat") {
        const box2 = new mdatBox(ret.size);
        this.parsingMdat = box2;
        this.boxes.push(box2);
        this.mdats.push(box2);
        box2.start = ret.start;
        box2.hdr_size = ret.hdr_size;
        box2.original_size = ret.original_size;
        this.stream.addUsedBytes(box2.hdr_size);
        this.lastBoxStartPosition = box2.start + box2.size;
        if (this.stream.seek(box2.start + box2.size, false, this.discardMdatData)) {
          this.transferMdatData();
          this.parsingMdat = void 0;
          return true;
        } else {
          if (!this.moovStartFound) this.nextParsePosition = box2.start + box2.size;
          else this.nextParsePosition = this.stream.findEndContiguousBuf();
          return false;
        }
      } else {
        if (ret.type === "moov") {
          this.moovStartFound = true;
          if (this.mdats.length === 0) this.isProgressive = true;
        }
        if (this.stream.mergeNextBuffer ? this.stream.mergeNextBuffer() : false) {
          this.nextParsePosition = this.stream.getEndPosition();
          return true;
        } else {
          if (!ret.type) this.nextParsePosition = this.stream.getEndPosition();
          else if (this.moovStartFound) this.nextParsePosition = this.stream.getEndPosition();
          else this.nextParsePosition = this.stream.getPosition() + ret.size;
          return false;
        }
      }
    }
    /** @bundle isofile-advanced-parsing.js */
    hasIncompleteMdat() {
      return this.parsingMdat !== void 0;
    }
    /**
    * Transfer the data of the mdat box to its stream
    * @param mdat the mdat box to use
    */
    transferMdatData(inMdat) {
      const mdat = inMdat ?? this.parsingMdat;
      if (this.discardMdatData) {
        Log.debug("ISOFile", "Discarding 'mdat' data, not transferring it to the mdat box stream");
        return;
      }
      if (!mdat) {
        Log.warn("ISOFile", "Cannot transfer 'mdat' data, no mdat box is being parsed");
        return;
      }
      const startBufferIndex = this.stream.findPosition(true, mdat.start + mdat.hdr_size, false);
      const endBufferIndex = this.stream.findPosition(true, mdat.start + mdat.size, false);
      if (startBufferIndex === -1 || endBufferIndex === -1) {
        Log.warn("ISOFile", "Cannot transfer 'mdat' data, start or end buffer not found");
        return;
      }
      mdat.stream = new MultiBufferStream();
      for (let i = startBufferIndex; i <= endBufferIndex; i++) {
        const buffer = this.stream.buffers[i];
        const startOffset = i === startBufferIndex ? mdat.start + mdat.hdr_size - buffer.fileStart : 0;
        const endOffset = i === endBufferIndex ? mdat.start + mdat.size - buffer.fileStart : buffer.byteLength;
        if (endOffset > startOffset) {
          Log.debug("ISOFile", "Transferring 'mdat' data from buffer #" + i + " (" + startOffset + " to " + endOffset + ")");
          const transferSize = endOffset - startOffset;
          const newBuffer = new MP4BoxBuffer(transferSize);
          const lastPosition = mdat.stream.getAbsoluteEndPosition();
          DataStream.memcpy(newBuffer, 0, buffer, startOffset, transferSize);
          newBuffer.fileStart = lastPosition;
          mdat.stream.insertBuffer(newBuffer);
          buffer.usedBytes += transferSize;
        }
      }
    }
    /** @bundle isofile-advanced-parsing.js */
    processIncompleteMdat() {
      const box2 = this.parsingMdat;
      if (this.stream.seek(box2.start + box2.size, false, this.discardMdatData)) {
        Log.debug("ISOFile", "Found 'mdat' end in buffered data");
        this.transferMdatData();
        this.parsingMdat = void 0;
        return true;
      } else {
        this.nextParsePosition = this.stream.findEndContiguousBuf();
        return false;
      }
    }
    /** @bundle isofile-advanced-parsing.js */
    restoreParsePosition() {
      return this.stream.seek(this.lastBoxStartPosition, true, this.discardMdatData);
    }
    /** @bundle isofile-advanced-parsing.js */
    saveParsePosition() {
      this.lastBoxStartPosition = this.stream.getPosition();
    }
    /** @bundle isofile-advanced-parsing.js */
    updateUsedBytes(box2, _ret) {
      if (this.stream.addUsedBytes) if (box2.type === "mdat") {
        this.stream.addUsedBytes(box2.hdr_size);
        if (this.discardMdatData) this.stream.addUsedBytes(box2.size - box2.hdr_size);
      } else this.stream.addUsedBytes(box2.size);
    }
    /** @bundle isofile-advanced-creation.js */
    addBox(box2) {
      return Box.prototype.addBox.call(this, box2);
    }
    /** @bundle isofile-advanced-creation.js */
    init(options = {}) {
      const ftyp = this.addBox(new ftypBox());
      ftyp.major_brand = options.brands && options.brands[0] || "iso4";
      ftyp.minor_version = 0;
      ftyp.compatible_brands = options.brands || ["iso4"];
      const moov = this.addBox(new moovBox());
      moov.addBox(new mvexBox());
      const mvhd = moov.addBox(new mvhdBox());
      mvhd.timescale = options.timescale || 600;
      mvhd.rate = options.rate || 65536;
      mvhd.creation_time = 0;
      mvhd.modification_time = 0;
      mvhd.duration = options.duration || 0;
      mvhd.volume = options.width ? 0 : 256;
      mvhd.matrix = [
        65536,
        0,
        0,
        0,
        65536,
        0,
        0,
        0,
        1073741824
      ];
      mvhd.next_track_id = 1;
      return this;
    }
    /** @bundle isofile-advanced-creation.js */
    addTrack(_options = {}) {
      if (!this.moov) this.init(_options);
      const options = _options || {};
      options.width = options.width || 320;
      options.height = options.height || 320;
      options.id = options.id || this.moov.mvhd.next_track_id;
      options.type = options.type || "avc1";
      const trak = this.moov.addBox(new trakBox());
      this.moov.mvhd.next_track_id = options.id + 1;
      const tkhd = trak.addBox(new tkhdBox());
      tkhd.flags = 1 | 2 | 4;
      tkhd.creation_time = 0;
      tkhd.modification_time = 0;
      tkhd.track_id = options.id;
      tkhd.duration = options.duration || 0;
      tkhd.layer = options.layer || 0;
      tkhd.alternate_group = 0;
      tkhd.volume = 1;
      tkhd.matrix = [
        65536,
        0,
        0,
        0,
        65536,
        0,
        0,
        0,
        1073741824
      ];
      tkhd.width = options.width << 16;
      tkhd.height = options.height << 16;
      const mdia = trak.addBox(new mdiaBox());
      const mdhd = mdia.addBox(new mdhdBox());
      mdhd.creation_time = 0;
      mdhd.modification_time = 0;
      mdhd.timescale = options.timescale || 1;
      mdhd.duration = options.media_duration || 0;
      mdhd.language = options.language || "und";
      const hdlr = mdia.addBox(new hdlrBox());
      hdlr.handler = options.hdlr || "vide";
      hdlr.name = options.name || "Track created with MP4Box.js";
      const elng = mdia.addBox(new elngBox());
      elng.extended_language = options.language || "fr-FR";
      const minf = mdia.addBox(new minfBox());
      const sampleEntry = BoxRegistry.sampleEntry[options.type];
      if (!sampleEntry) return;
      const sample_description_entry = new sampleEntry();
      sample_description_entry.data_reference_index = 1;
      if (sample_description_entry instanceof VisualSampleEntry) {
        const sde = sample_description_entry;
        const vmhd = minf.addBox(new vmhdBox());
        vmhd.graphicsmode = 0;
        vmhd.opcolor = [
          0,
          0,
          0
        ];
        sde.width = options.width;
        sde.height = options.height;
        sde.horizresolution = 72 << 16;
        sde.vertresolution = 72 << 16;
        sde.frame_count = 1;
        sde.compressorname = options.type + " Compressor";
        sde.depth = 24;
        if (options.avcDecoderConfigRecord) sde.addBox(new avcCBox(options.avcDecoderConfigRecord.byteLength)).parse(new DataStream(options.avcDecoderConfigRecord));
        else if (options.hevcDecoderConfigRecord) sde.addBox(new hvcCBox(options.hevcDecoderConfigRecord.byteLength)).parse(new DataStream(options.hevcDecoderConfigRecord));
      } else if (sample_description_entry instanceof AudioSampleEntry) {
        const sde = sample_description_entry;
        const smhd = minf.addBox(new smhdBox());
        smhd.balance = options.balance || 0;
        sde.channel_count = options.channel_count || 2;
        sde.samplesize = options.samplesize || 16;
        sde.samplerate = options.samplerate || 65536;
      } else if (sample_description_entry instanceof HintSampleEntry) minf.addBox(new hmhdBox());
      else if (sample_description_entry instanceof SubtitleSampleEntry) {
        minf.addBox(new sthdBox());
        if (sample_description_entry instanceof stppSampleEntry) {
          sample_description_entry.namespace = options.namespace || "nonamespace";
          sample_description_entry.schema_location = options.schema_location || "";
          sample_description_entry.auxiliary_mime_types = options.auxiliary_mime_types || "";
        }
      } else if (sample_description_entry instanceof MetadataSampleEntry) minf.addBox(new nmhdBox());
      else if (sample_description_entry instanceof SystemSampleEntry) minf.addBox(new nmhdBox());
      else minf.addBox(new nmhdBox());
      if (options.description) sample_description_entry.addBox.call(sample_description_entry, options.description);
      if (options.description_boxes) options.description_boxes.forEach(function(b) {
        sample_description_entry.addBox.call(sample_description_entry, b);
      });
      const dref = minf.addBox(new dinfBox()).addBox(new drefBox());
      const url = new urlBox();
      url.flags = 1;
      dref.addEntry(url);
      const stbl = minf.addBox(new stblBox());
      stbl.addBox(new stsdBox()).addEntry(sample_description_entry);
      const stts = stbl.addBox(new sttsBox());
      stts.sample_counts = [];
      stts.sample_deltas = [];
      const stsc = stbl.addBox(new stscBox());
      stsc.first_chunk = [];
      stsc.samples_per_chunk = [];
      stsc.sample_description_index = [];
      const stco = stbl.addBox(new stcoBox());
      stco.chunk_offsets = [];
      const stsz = stbl.addBox(new stszBox());
      stsz.sample_sizes = [];
      const trex = this.moov.mvex.addBox(new trexBox());
      trex.track_id = options.id;
      trex.default_sample_description_index = options.default_sample_description_index || 1;
      trex.default_sample_duration = options.default_sample_duration || 0;
      trex.default_sample_size = options.default_sample_size || 0;
      trex.default_sample_flags = options.default_sample_flags || 0;
      this.buildTrakSampleLists(trak);
      return options.id;
    }
    /** @bundle isofile-advanced-creation.js */
    addSample(track_id, data, { sample_description_index, duration = 1, cts = 0, dts = 0, is_sync = false, is_leading = 0, depends_on = 0, is_depended_on = 0, has_redundancy = 0, degradation_priority = 0, subsamples, offset = 0 } = {}) {
      const trak = this.getTrackById(track_id);
      if (trak === void 0) return;
      const descriptionIndex = sample_description_index ? sample_description_index - 1 : 0;
      const sample = {
        number: trak.samples.length,
        track_id: trak.tkhd.track_id,
        timescale: trak.mdia.mdhd.timescale,
        description_index: descriptionIndex,
        description: trak.mdia.minf.stbl.stsd.entries[descriptionIndex],
        data,
        size: data.byteLength,
        alreadyRead: data.byteLength,
        duration,
        cts,
        dts,
        is_sync,
        is_leading,
        depends_on,
        is_depended_on,
        has_redundancy,
        degradation_priority,
        offset,
        subsamples
      };
      trak.samples.push(sample);
      trak.samples_size += sample.size;
      trak.samples_duration += sample.duration;
      if (trak.first_dts === void 0) trak.first_dts = dts;
      this.processSamples();
      const moof = this.addBox(this.createMoof([sample]));
      moof.computeSize();
      moof.trafs[0].truns[0].data_offset = moof.size + 8;
      const mdat = this.addBox(new mdatBox());
      mdat.data = new Uint8Array(data);
      return sample;
    }
    /** @bundle isofile-advanced-creation.js */
    createMoof(samples) {
      if (samples.length === 0) return;
      if (samples.some((s) => s.track_id !== samples[0].track_id)) throw new Error("Cannot create moof for samples from different tracks: " + samples.map((s) => s.track_id).join(", "));
      const trackId = samples[0].track_id;
      const trak = this.getTrackById(trackId);
      if (!trak) throw new Error("Cannot create moof for non-existing track: " + trackId);
      const moof = new moofBox();
      const mfhd = moof.addBox(new mfhdBox());
      mfhd.sequence_number = ++this.nextMoofNumber;
      const traf = moof.addBox(new trafBox());
      const tfhd = traf.addBox(new tfhdBox());
      tfhd.track_id = trackId;
      tfhd.flags = TFHD_FLAG_DEFAULT_BASE_IS_MOOF;
      const tfdt = traf.addBox(new tfdtBox());
      tfdt.baseMediaDecodeTime = samples[0].dts - (trak.first_dts || 0);
      const trun = traf.addBox(new trunBox());
      trun.flags = 1 | 256 | 512 | TRUN_FLAGS_FLAGS | TRUN_FLAGS_CTS_OFFSET;
      trun.data_offset = 0;
      trun.first_sample_flags = 0;
      trun.sample_count = samples.length;
      for (const sample of samples) {
        let sample_flags = 0;
        if (sample.is_sync) sample_flags = 1 << 25;
        else sample_flags = 65536;
        trun.sample_duration.push(sample.duration);
        trun.sample_size.push(sample.size);
        trun.sample_flags.push(sample_flags);
        trun.sample_composition_time_offset.push(sample.cts - sample.dts);
      }
      return moof;
    }
    /** @bundle box-print.js */
    print(output) {
      output.indent = "";
      for (let i = 0; i < this.boxes.length; i++) if (this.boxes[i]) this.boxes[i].print(output);
    }
  };
  function createFile(keepMdatData = false, stream) {
    return new ISOFile(stream, !keepMdatData);
  }
  var _a138;
  var emsgBox = (_a138 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "EventMessageBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 1) {
        this.timescale = stream.readUint32();
        this.presentation_time = stream.readUint64();
        this.event_duration = stream.readUint32();
        this.id = stream.readUint32();
        this.scheme_id_uri = stream.readCString();
        this.value = stream.readCString();
      } else {
        this.scheme_id_uri = stream.readCString();
        this.value = stream.readCString();
        this.timescale = stream.readUint32();
        this.presentation_time_delta = stream.readUint32();
        this.event_duration = stream.readUint32();
        this.id = stream.readUint32();
      }
      let message_size = this.size - this.hdr_size - (16 + (this.scheme_id_uri.length + 1) + (this.value.length + 1));
      if (this.version === 1) message_size -= 4;
      this.message_data = stream.readUint8Array(message_size);
    }
    /** @bundle writing/emsg.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 16 + this.message_data.length + (this.scheme_id_uri.length + 1) + (this.value.length + 1);
      this.writeHeader(stream);
      stream.writeCString(this.scheme_id_uri);
      stream.writeCString(this.value);
      stream.writeUint32(this.timescale);
      stream.writeUint32(this.presentation_time_delta);
      stream.writeUint32(this.event_duration);
      stream.writeUint32(this.id);
      stream.writeUint8Array(this.message_data);
    }
  }, _a138.fourcc = "emsg", _a138);
  var _a139;
  var ssixBox = (_a139 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CompressedSubsegmentIndexBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.subsegments = [];
      const subsegment_count = stream.readUint32();
      for (let i = 0; i < subsegment_count; i++) {
        const subsegment = {};
        this.subsegments.push(subsegment);
        subsegment.ranges = [];
        const range_count = stream.readUint32();
        for (let j = 0; j < range_count; j++) {
          const range = {};
          subsegment.ranges.push(range);
          range.level = stream.readUint8();
          range.range_size = stream.readUint24();
        }
      }
    }
  }, _a139.fourcc = "ssix", _a139);
  var _a140;
  var stypBox = (_a140 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SegmentTypeBox";
    }
    parse(stream) {
      let toparse = this.size - this.hdr_size;
      this.major_brand = stream.readString(4);
      this.minor_version = stream.readUint32();
      toparse -= 8;
      this.compatible_brands = [];
      let i = 0;
      while (toparse >= 4) {
        this.compatible_brands[i] = stream.readString(4);
        toparse -= 4;
        i++;
      }
    }
    write(stream) {
      this.size = 8 + 4 * this.compatible_brands.length;
      this.writeHeader(stream);
      stream.writeString(this.major_brand, void 0, 4);
      stream.writeUint32(this.minor_version);
      for (let i = 0; i < this.compatible_brands.length; i++) stream.writeString(this.compatible_brands[i], void 0, 4);
    }
  }, _a140.fourcc = "styp", _a140);

  // node_modules/.pnpm/mp4box@2.4.1/node_modules/mp4box/dist/mp4box.all.mjs
  var descriptor_exports = /* @__PURE__ */ __exportAll({
    Descriptor: () => Descriptor,
    ES_Descriptor: () => ES_Descriptor,
    MPEG4DescriptorParser: () => MPEG4DescriptorParser
  });
  var ES_DescrTag = 3;
  var DecoderConfigDescrTag = 4;
  var DecSpecificInfoTag = 5;
  var SLConfigDescrTag = 6;
  var Descriptor = class Descriptor2 {
    constructor(tag, size) {
      this.tag = tag;
      this.size = size;
      this.descs = [];
    }
    parse(stream) {
      this.data = stream.readUint8Array(this.size);
    }
    findDescriptor(tag) {
      for (let i = 0; i < this.descs.length; i++) if (this.descs[i].tag === tag) return this.descs[i];
    }
    parseOneDescriptor(stream) {
      let size = 0;
      const tag = stream.readUint8();
      let byteRead = stream.readUint8();
      while (byteRead & 128) {
        size = (size << 7) + (byteRead & 127);
        byteRead = stream.readUint8();
      }
      size = (size << 7) + (byteRead & 127);
      Log.debug("Descriptor", "Found " + (descTagToName[tag] || "Descriptor " + tag) + ", size " + size + " at position " + stream.getPosition());
      const desc = descTagToName[tag] ? new DESCRIPTOR_CLASSES[descTagToName[tag]](size) : new Descriptor2(size);
      desc.parse(stream);
      return desc;
    }
    parseRemainingDescriptors(stream) {
      const start2 = stream.getPosition();
      while (stream.getPosition() < start2 + this.size) {
        const desc = this.parseOneDescriptor?.(stream);
        this.descs.push(desc);
      }
    }
  };
  var ES_Descriptor = class extends Descriptor {
    constructor(size) {
      super(ES_DescrTag, size);
    }
    parse(stream) {
      this.ES_ID = stream.readUint16();
      this.flags = stream.readUint8();
      this.size -= 3;
      if (this.flags & 128) {
        this.dependsOn_ES_ID = stream.readUint16();
        this.size -= 2;
      } else this.dependsOn_ES_ID = 0;
      if (this.flags & 64) {
        const l = stream.readUint8();
        this.URL = stream.readString(l);
        this.size -= l + 1;
      } else this.URL = "";
      if (this.flags & 32) {
        this.OCR_ES_ID = stream.readUint16();
        this.size -= 2;
      } else this.OCR_ES_ID = 0;
      this.parseRemainingDescriptors(stream);
    }
    getOTI() {
      const dcd = this.findDescriptor(DecoderConfigDescrTag);
      if (dcd) return dcd.oti;
      else return 0;
    }
    getAudioConfig() {
      const dcd = this.findDescriptor(DecoderConfigDescrTag);
      if (!dcd) return;
      const dsi = dcd.findDescriptor(DecSpecificInfoTag);
      if (dsi && dsi.data) {
        let audioObjectType = (dsi.data[0] & 248) >> 3;
        if (audioObjectType === 31 && dsi.data.length >= 2) audioObjectType = 32 + ((dsi.data[0] & 7) << 3) + ((dsi.data[1] & 224) >> 5);
        return audioObjectType;
      }
    }
  };
  var DecoderConfigDescriptor = class extends Descriptor {
    constructor(size) {
      super(DecoderConfigDescrTag, size);
    }
    parse(stream) {
      this.oti = stream.readUint8();
      this.streamType = stream.readUint8();
      this.upStream = (this.streamType >> 1 & 1) !== 0;
      this.streamType = this.streamType >>> 2;
      this.bufferSize = stream.readUint24();
      this.maxBitrate = stream.readUint32();
      this.avgBitrate = stream.readUint32();
      this.size -= 13;
      this.parseRemainingDescriptors(stream);
    }
  };
  var DecoderSpecificInfo = class extends Descriptor {
    constructor(size) {
      super(DecSpecificInfoTag, size);
    }
  };
  var SLConfigDescriptor = class extends Descriptor {
    constructor(size) {
      super(SLConfigDescrTag, size);
    }
  };
  var DESCRIPTOR_CLASSES = {
    Descriptor,
    ES_Descriptor,
    DecoderConfigDescriptor,
    DecoderSpecificInfo,
    SLConfigDescriptor
  };
  var descTagToName = {
    [ES_DescrTag]: "ES_Descriptor",
    [DecoderConfigDescrTag]: "DecoderConfigDescriptor",
    [DecSpecificInfoTag]: "DecoderSpecificInfo",
    [SLConfigDescrTag]: "SLConfigDescriptor"
  };
  var MPEG4DescriptorParser = class {
    constructor() {
      this.parseOneDescriptor = Descriptor.prototype.parseOneDescriptor;
    }
    getDescriptorName(tag) {
      return descTagToName[tag];
    }
  };
  var _a141;
  var a1lxBox = (_a141 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "AV1LayeredImageIndexingProperty";
    }
    parse(stream) {
      const FieldLength = ((stream.readUint8() & 1) + 1) * 16;
      this.layer_size = [];
      for (let i = 0; i < 3; i++) if (FieldLength === 16) this.layer_size[i] = stream.readUint16();
      else this.layer_size[i] = stream.readUint32();
    }
  }, _a141.fourcc = "a1lx", _a141);
  var _a142;
  var a1opBox = (_a142 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "OperatingPointSelectorProperty";
    }
    parse(stream) {
      this.op_index = stream.readUint8();
    }
  }, _a142.fourcc = "a1op", _a142);
  var _a143;
  var auxCBox = (_a143 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "AuxiliaryTypeProperty";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.aux_type = stream.readCString();
      const aux_subtype_length = this.size - this.hdr_size - (this.aux_type.length + 1);
      this.aux_subtype = stream.readUint8Array(aux_subtype_length);
    }
  }, _a143.fourcc = "auxC", _a143);
  var _a144;
  var btrtBox = (_a144 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "BitRateBox";
    }
    parse(stream) {
      this.bufferSizeDB = stream.readUint32();
      this.maxBitrate = stream.readUint32();
      this.avgBitrate = stream.readUint32();
    }
  }, _a144.fourcc = "btrt", _a144);
  var _a145;
  var ccstBox = (_a145 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CodingConstraintsBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const flags = stream.readUint8();
      this.all_ref_pics_intra = (flags & 128) === 128;
      this.intra_pred_used = (flags & 64) === 64;
      this.max_ref_per_pic = (flags & 63) >> 2;
      stream.readUint24();
    }
  }, _a145.fourcc = "ccst", _a145);
  var _a146;
  var cdefBox = (_a146 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ComponentDefinitionBox";
    }
    parse(stream) {
      this.channel_count = stream.readUint16();
      this.channel_indexes = [];
      this.channel_types = [];
      this.channel_associations = [];
      for (let i = 0; i < this.channel_count; i++) {
        this.channel_indexes.push(stream.readUint16());
        this.channel_types.push(stream.readUint16());
        this.channel_associations.push(stream.readUint16());
      }
    }
  }, _a146.fourcc = "cdef", _a146);
  var _a147;
  var clapBox = (_a147 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CleanApertureBox";
    }
    parse(stream) {
      this.cleanApertureWidthN = stream.readUint32();
      this.cleanApertureWidthD = stream.readUint32();
      this.cleanApertureHeightN = stream.readUint32();
      this.cleanApertureHeightD = stream.readUint32();
      this.horizOffN = stream.readUint32();
      this.horizOffD = stream.readUint32();
      this.vertOffN = stream.readUint32();
      this.vertOffD = stream.readUint32();
    }
  }, _a147.fourcc = "clap", _a147);
  var _a148;
  var clliBox = (_a148 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ContentLightLevelBox";
    }
    parse(stream) {
      this.max_content_light_level = stream.readUint16();
      this.max_pic_average_light_level = stream.readUint16();
    }
  }, _a148.fourcc = "clli", _a148);
  var _a149;
  var cmexBox = (_a149 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CameraExtrinsicMatrixProperty";
    }
    parse(stream) {
      if (this.flags & 1) this.pos_x = stream.readInt32();
      if (this.flags & 2) this.pos_y = stream.readInt32();
      if (this.flags & 4) this.pos_z = stream.readInt32();
      if (this.flags & 8) {
        if (this.version === 0) if (this.flags & 16) {
          this.quat_x = stream.readInt32();
          this.quat_y = stream.readInt32();
          this.quat_z = stream.readInt32();
        } else {
          this.quat_x = stream.readInt16();
          this.quat_y = stream.readInt16();
          this.quat_z = stream.readInt16();
        }
        else if (this.version === 1) {
        }
      }
      if (this.flags & 32) this.id = stream.readUint32();
    }
  }, _a149.fourcc = "cmex", _a149);
  var _a150;
  var cminBox = (_a150 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CameraIntrinsicMatrixProperty";
    }
    parse(stream) {
      this.focal_length_x = stream.readInt32();
      this.principal_point_x = stream.readInt32();
      this.principal_point_y = stream.readInt32();
      if (this.flags & 1) {
        this.focal_length_y = stream.readInt32();
        this.skew_factor = stream.readInt32();
      }
    }
  }, _a150.fourcc = "cmin", _a150);
  var _a151;
  var cmpCBox = (_a151 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CompressionConfigurationBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.compression_type = stream.readString(4);
      this.compressed_unit_type = stream.readUint8();
    }
  }, _a151.fourcc = "cmpC", _a151);
  var _a152;
  var cmpdBox = (_a152 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ComponentDefinitionBox";
    }
    parse(stream) {
      this.component_count = stream.readUint32();
      this.component_types = [];
      this.component_type_urls = [];
      for (let i = 0; i < this.component_count; i++) {
        const component_type = stream.readUint16();
        this.component_types.push(component_type);
        if (component_type >= 32768) this.component_type_urls.push(stream.readCString());
      }
    }
  }, _a152.fourcc = "cmpd", _a152);
  var _a153;
  var co64Box = (_a153 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ChunkLargeOffsetBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const entry_count = stream.readUint32();
      this.chunk_offsets = [];
      if (this.version === 0) for (let i = 0; i < entry_count; i++) this.chunk_offsets.push(stream.readUint64());
    }
    /** @bundle writing/co64.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 8 * this.chunk_offsets.length;
      this.writeHeader(stream);
      stream.writeUint32(this.chunk_offsets.length);
      for (let i = 0; i < this.chunk_offsets.length; i++) stream.writeUint64(this.chunk_offsets[i]);
    }
  }, _a153.fourcc = "co64", _a153);
  var _a154;
  var CoLLBox = (_a154 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ContentLightLevelBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.maxCLL = stream.readUint16();
      this.maxFALL = stream.readUint16();
    }
  }, _a154.fourcc = "CoLL", _a154);
  var SphereRegion = class {
    toString() {
      let s = "centre_azimuth: ";
      s += this.centre_azimuth;
      s += " (";
      s += this.centre_azimuth * 2 ** -16;
      s += "\xB0), centre_elevation: ";
      s += this.centre_elevation;
      s += " (";
      s += this.centre_elevation * 2 ** -16;
      s += "\xB0), centre_tilt: ";
      s += this.centre_tilt;
      s += " (";
      s += this.centre_tilt * 2 ** -16;
      s += "\xB0)";
      if (this.range_included_flag) {
        s += ", azimuth_range: ";
        s += this.azimuth_range;
        s += " (";
        s += this.azimuth_range * 2 ** -16;
        s += "\xB0), elevation_range: ";
        s += this.elevation_range;
        s += " (";
        s += this.elevation_range * 2 ** -16;
        s += "\xB0)";
      }
      if (this.interpolate_included_flag) {
        s += ", interpolate: ";
        s += this.interpolate;
      }
      return s;
    }
  };
  var CoverageSphereRegion = class {
    toString() {
      let s = "";
      if (this.view_idc) {
        s += "view_idc: ";
        s += this.view_idc;
        s += ", ";
      }
      s += "sphere_region: {";
      s += this.sphere_region;
      s += "}";
      return s;
    }
  };
  var _a155;
  var coviBox = (_a155 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CoverageInformationBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.coverage_shape_type = stream.readUint8();
      const num_regions = stream.readUint8();
      const f = stream.readInt8();
      const view_idc_presence_flag = f & 128;
      if (view_idc_presence_flag) this.default_view_idc = (f & 96) >> 5;
      this.coverage_regions = new Array();
      for (let i = 0; i < num_regions; i++) {
        const region = new CoverageSphereRegion();
        if (view_idc_presence_flag) region.view_idc = stream.readUint8() >> 6;
        region.sphere_region = this.parseSphereRegion(stream, true, true);
        this.coverage_regions.push(region);
      }
    }
    parseSphereRegion(stream, range_included_flag, interpolate_included_flag) {
      const sphere_region = new SphereRegion();
      sphere_region.centre_azimuth = stream.readInt32();
      sphere_region.centre_elevation = stream.readInt32();
      sphere_region.centre_tilt = stream.readInt32();
      sphere_region.range_included_flag = range_included_flag;
      if (range_included_flag) {
        sphere_region.azimuth_range = stream.readUint32();
        sphere_region.elevation_range = stream.readUint32();
      }
      sphere_region.interpolate_included_flag = interpolate_included_flag;
      if (interpolate_included_flag) sphere_region.interpolate = (stream.readUint8() & 128) === 128;
      return sphere_region;
    }
  }, _a155.fourcc = "covi", _a155);
  var _a156;
  var cprtBox = (_a156 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CopyrightBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.parseLanguage(stream);
      this.notice = stream.readCString();
    }
  }, _a156.fourcc = "cprt", _a156);
  var _a157;
  var cschBox = (_a157 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CompatibleSchemeTypeBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.scheme_type = stream.readString(4);
      this.scheme_version = stream.readUint32();
      if (this.flags & 1) this.scheme_uri = stream.readCString();
    }
  }, _a157.fourcc = "csch", _a157);
  var INT32_MAX = 2147483647;
  var _a158;
  var cslgBox = (_a158 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CompositionToDecodeBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 0) {
        this.compositionToDTSShift = stream.readInt32();
        this.leastDecodeToDisplayDelta = stream.readInt32();
        this.greatestDecodeToDisplayDelta = stream.readInt32();
        this.compositionStartTime = stream.readInt32();
        this.compositionEndTime = stream.readInt32();
      } else if (this.version === 1) {
        this.compositionToDTSShift = stream.readInt64();
        this.leastDecodeToDisplayDelta = stream.readInt64();
        this.greatestDecodeToDisplayDelta = stream.readInt64();
        this.compositionStartTime = stream.readInt64();
        this.compositionEndTime = stream.readInt64();
      }
    }
    /** @bundle writing/cslg.js */
    write(stream) {
      this.version = 0;
      if (this.compositionToDTSShift > INT32_MAX || this.leastDecodeToDisplayDelta > INT32_MAX || this.greatestDecodeToDisplayDelta > INT32_MAX || this.compositionStartTime > INT32_MAX || this.compositionEndTime > INT32_MAX) this.version = 1;
      this.flags = 0;
      if (this.version === 0) {
        this.size = 20;
        this.writeHeader(stream);
        stream.writeInt32(this.compositionToDTSShift);
        stream.writeInt32(this.leastDecodeToDisplayDelta);
        stream.writeInt32(this.greatestDecodeToDisplayDelta);
        stream.writeInt32(this.compositionStartTime);
        stream.writeInt32(this.compositionEndTime);
      } else if (this.version === 1) {
        this.size = 40;
        this.writeHeader(stream);
        stream.writeInt64(this.compositionToDTSShift);
        stream.writeInt64(this.leastDecodeToDisplayDelta);
        stream.writeInt64(this.greatestDecodeToDisplayDelta);
        stream.writeInt64(this.compositionStartTime);
        stream.writeInt64(this.compositionEndTime);
      }
    }
  }, _a158.fourcc = "cslg", _a158);
  var _a159;
  var cttsBox = (_a159 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CompositionOffsetBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const entry_count = stream.readUint32();
      this.sample_counts = [];
      this.sample_offsets = [];
      if (this.version === 0) for (let i = 0; i < entry_count; i++) {
        this.sample_counts.push(stream.readUint32());
        const value = stream.readInt32();
        if (value < 0) Log.warn("BoxParser", "ctts box uses negative values without using version 1");
        this.sample_offsets.push(value);
      }
      else if (this.version === 1) for (let i = 0; i < entry_count; i++) {
        this.sample_counts.push(stream.readUint32());
        this.sample_offsets.push(stream.readInt32());
      }
    }
    /** @bundle writing/ctts.js */
    write(stream) {
      this.version = this.sample_offsets.some((offset) => offset < 0) ? 1 : 0;
      this.flags = 0;
      this.size = 4 + 8 * this.sample_counts.length;
      this.writeHeader(stream);
      stream.writeUint32(this.sample_counts.length);
      for (let i = 0; i < this.sample_counts.length; i++) {
        stream.writeUint32(this.sample_counts[i]);
        if (this.version === 1) stream.writeInt32(this.sample_offsets[i]);
        else stream.writeUint32(this.sample_offsets[i]);
      }
    }
    /** @bundle box-unpack.js */
    unpack(samples) {
      let k = 0;
      for (let i = 0; i < this.sample_counts.length; i++) for (let j = 0; j < this.sample_counts[i]; j++) {
        samples[k].pts = samples[k].dts + this.sample_offsets[i];
        k++;
      }
    }
  }, _a159.fourcc = "ctts", _a159);
  var _a160;
  var dac3Box = (_a160 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "AC3SpecificBox";
    }
    parse(stream) {
      const tmp_byte1 = stream.readUint8();
      const tmp_byte2 = stream.readUint8();
      const tmp_byte3 = stream.readUint8();
      this.fscod = tmp_byte1 >> 6;
      this.bsid = tmp_byte1 >> 1 & 31;
      this.bsmod = (tmp_byte1 & 1) << 2 | tmp_byte2 >> 6 & 3;
      this.acmod = tmp_byte2 >> 3 & 7;
      this.lfeon = tmp_byte2 >> 2 & 1;
      this.bit_rate_code = tmp_byte2 & 3 | tmp_byte3 >> 5 & 7;
    }
  }, _a160.fourcc = "dac3", _a160);
  var _a161;
  var dec3Box = (_a161 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "EC3SpecificBox";
    }
    parse(stream) {
      const tmp_16 = stream.readUint16();
      this.data_rate = tmp_16 >> 3;
      this.num_ind_sub = tmp_16 & 7;
      this.ind_subs = [];
      for (let i = 0; i < this.num_ind_sub + 1; i++) {
        const tmp_byte1 = stream.readUint8();
        const tmp_byte2 = stream.readUint8();
        const tmp_byte3 = stream.readUint8();
        const ind_sub = {
          fscod: tmp_byte1 >> 6,
          bsid: tmp_byte1 >> 1 & 31,
          bsmod: (tmp_byte1 & 1) << 4 | tmp_byte2 >> 4 & 15,
          acmod: tmp_byte2 >> 1 & 7,
          lfeon: tmp_byte2 & 1,
          num_dep_sub: tmp_byte3 >> 1 & 15
        };
        this.ind_subs.push(ind_sub);
        if (ind_sub.num_dep_sub > 0) ind_sub.chan_loc = (tmp_byte3 & 1) << 8 | stream.readUint8();
      }
    }
  }, _a161.fourcc = "dec3", _a161);
  var _a162;
  var dfLaBox = (_a162 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "FLACSpecificBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const BLOCKTYPE_MASK = 127;
      const LASTMETADATABLOCKFLAG_MASK = 128;
      const boxesFound = [];
      const knownBlockTypes = [
        "STREAMINFO",
        "PADDING",
        "APPLICATION",
        "SEEKTABLE",
        "VORBIS_COMMENT",
        "CUESHEET",
        "PICTURE",
        "RESERVED"
      ];
      let flagAndType;
      do {
        flagAndType = stream.readUint8();
        const type = Math.min(flagAndType & BLOCKTYPE_MASK, knownBlockTypes.length - 1);
        if (!type) {
          stream.readUint8Array(13);
          this.samplerate = stream.readUint32() >> 12;
          stream.readUint8Array(20);
        } else stream.readUint8Array(stream.readUint24());
        boxesFound.push(knownBlockTypes[type]);
      } while (flagAndType & LASTMETADATABLOCKFLAG_MASK);
      this.numMetadataBlocks = boxesFound.length + " (" + boxesFound.join(", ") + ")";
    }
  }, _a162.fourcc = "dfLa", _a162);
  var _a163;
  var dimmBox = (_a163 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintimmediateBytesSent";
    }
    parse(stream) {
      this.bytessent = stream.readUint64();
    }
  }, _a163.fourcc = "dimm", _a163);
  var _a164;
  var dmax = (_a164 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintlongestpacket";
    }
    parse(stream) {
      this.time = stream.readUint32();
    }
  }, _a164.fourcc = "dmax", _a164);
  var _a165;
  var dmedBox = (_a165 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintmediaBytesSent";
    }
    parse(stream) {
      this.bytessent = stream.readUint64();
    }
  }, _a165.fourcc = "dmed", _a165);
  var _a166;
  var dOpsBox = (_a166 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "OpusSpecificBox";
    }
    parse(stream) {
      this.Version = stream.readUint8();
      this.OutputChannelCount = stream.readUint8();
      this.PreSkip = stream.readUint16();
      this.InputSampleRate = stream.readUint32();
      this.OutputGain = stream.readInt16();
      this.ChannelMappingFamily = stream.readUint8();
      if (this.ChannelMappingFamily !== 0) {
        this.StreamCount = stream.readUint8();
        this.CoupledCount = stream.readUint8();
        this.ChannelMapping = [];
        for (let i = 0; i < this.OutputChannelCount; i++) this.ChannelMapping[i] = stream.readUint8();
      }
    }
    write(stream) {
      this.size = 11;
      if (this.ChannelMappingFamily !== 0) this.size += 2 + this.OutputChannelCount;
      this.writeHeader(stream);
      stream.writeUint8(this.Version);
      stream.writeUint8(this.OutputChannelCount);
      stream.writeUint16(this.PreSkip);
      stream.writeUint32(this.InputSampleRate);
      stream.writeInt16(this.OutputGain);
      stream.writeUint8(this.ChannelMappingFamily);
      if (this.ChannelMappingFamily !== 0) {
        stream.writeUint8(this.StreamCount);
        stream.writeUint8(this.CoupledCount);
        for (let i = 0; i < this.OutputChannelCount; i++) stream.writeUint8(this.ChannelMapping[i]);
      }
    }
  }, _a166.fourcc = "dOps", _a166);
  var _a167;
  var drepBox = (_a167 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintrepeatedBytesSent";
    }
    parse(stream) {
      this.bytessent = stream.readUint64();
    }
  }, _a167.fourcc = "drep", _a167);
  var _a168;
  var elstBox = (_a168 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "EditListBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.entries = [];
      const entry_count = stream.readUint32();
      for (let i = 0; i < entry_count; i++) {
        const entry = {
          segment_duration: this.version === 1 ? stream.readUint64() : stream.readUint32(),
          media_time: this.version === 1 ? stream.readInt64() : stream.readInt32(),
          media_rate_integer: stream.readInt16(),
          media_rate_fraction: stream.readInt16()
        };
        this.entries.push(entry);
      }
    }
    /** @bundle writing/elst.js */
    write(stream) {
      const useVersion1 = this.entries.some((entry) => entry.segment_duration > MAX_UINT32 || entry.media_time > MAX_UINT32) || this.version === 1;
      this.version = useVersion1 ? 1 : 0;
      this.size = 4 + 12 * this.entries.length;
      this.size += useVersion1 ? 8 * this.entries.length : 0;
      this.writeHeader(stream);
      stream.writeUint32(this.entries.length);
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        if (useVersion1) {
          stream.writeUint64(entry.segment_duration);
          stream.writeInt64(entry.media_time);
        } else {
          stream.writeUint32(entry.segment_duration);
          stream.writeInt32(entry.media_time);
        }
        stream.writeInt16(entry.media_rate_integer);
        stream.writeInt16(entry.media_rate_fraction);
      }
    }
  }, _a168.fourcc = "elst", _a168);
  var EntityToGroup = class extends FullBox {
    parse(stream) {
      this.parseFullHeader(stream);
      this.group_id = stream.readUint32();
      this.num_entities_in_group = stream.readUint32();
      this.entity_ids = [];
      for (let i = 0; i < this.num_entities_in_group; i++) {
        const entity_id = stream.readUint32();
        this.entity_ids.push(entity_id);
      }
    }
  };
  var _a169;
  var aebrBox = (_a169 = class extends EntityToGroup {
    constructor(..._args) {
      super(..._args);
      this.box_name = "Auto exposure bracketing";
    }
  }, _a169.fourcc = "aebr", _a169);
  var _a170;
  var afbrBox = (_a170 = class extends EntityToGroup {
    constructor(..._args2) {
      super(..._args2);
      this.box_name = "Flash exposure information";
    }
  }, _a170.fourcc = "afbr", _a170);
  var _a171;
  var albcBox = (_a171 = class extends EntityToGroup {
    constructor(..._args3) {
      super(..._args3);
      this.box_name = "Album collection";
    }
  }, _a171.fourcc = "albc", _a171);
  var _a172;
  var altrBox = (_a172 = class extends EntityToGroup {
    constructor(..._args4) {
      super(..._args4);
      this.box_name = "Alternative entity";
    }
  }, _a172.fourcc = "altr", _a172);
  var _a173;
  var brstBox = (_a173 = class extends EntityToGroup {
    constructor(..._args5) {
      super(..._args5);
      this.box_name = "Burst image";
    }
  }, _a173.fourcc = "brst", _a173);
  var _a174;
  var dobrBox = (_a174 = class extends EntityToGroup {
    constructor(..._args6) {
      super(..._args6);
      this.box_name = "Depth of field bracketing";
    }
  }, _a174.fourcc = "dobr", _a174);
  var _a175;
  var eqivBox = (_a175 = class extends EntityToGroup {
    constructor(..._args7) {
      super(..._args7);
      this.box_name = "Equivalent entity";
    }
  }, _a175.fourcc = "eqiv", _a175);
  var _a176;
  var favcBox = (_a176 = class extends EntityToGroup {
    constructor(..._args8) {
      super(..._args8);
      this.box_name = "Favorites collection";
    }
  }, _a176.fourcc = "favc", _a176);
  var _a177;
  var fobrBox = (_a177 = class extends EntityToGroup {
    constructor(..._args9) {
      super(..._args9);
      this.box_name = "Focus bracketing";
    }
  }, _a177.fourcc = "fobr", _a177);
  var _a178;
  var iaugBox = (_a178 = class extends EntityToGroup {
    constructor(..._args10) {
      super(..._args10);
      this.box_name = "Image item with an audio track";
    }
  }, _a178.fourcc = "iaug", _a178);
  var _a179;
  var panoBox = (_a179 = class extends EntityToGroup {
    constructor(..._args11) {
      super(..._args11);
      this.box_name = "Panorama";
    }
  }, _a179.fourcc = "pano", _a179);
  var _a180;
  var slidBox = (_a180 = class extends EntityToGroup {
    constructor(..._args12) {
      super(..._args12);
      this.box_name = "Slideshow";
    }
  }, _a180.fourcc = "slid", _a180);
  var _a181;
  var sterBox = (_a181 = class extends EntityToGroup {
    constructor(..._args13) {
      super(..._args13);
      this.box_name = "Stereo";
    }
  }, _a181.fourcc = "ster", _a181);
  var _a182;
  var tsynBox = (_a182 = class extends EntityToGroup {
    constructor(..._args14) {
      super(..._args14);
      this.box_name = "Time-synchronized capture";
    }
  }, _a182.fourcc = "tsyn", _a182);
  var _a183;
  var wbbrBox = (_a183 = class extends EntityToGroup {
    constructor(..._args15) {
      super(..._args15);
      this.box_name = "White balance bracketing";
    }
  }, _a183.fourcc = "wbbr", _a183);
  var _a184;
  var prgrBox = (_a184 = class extends EntityToGroup {
    constructor(..._args16) {
      super(..._args16);
      this.box_name = "Progressive rendering";
    }
  }, _a184.fourcc = "prgr", _a184);
  var _a185;
  var pymdBox = (_a185 = class extends EntityToGroup {
    constructor(..._args17) {
      super(..._args17);
      this.box_name = "Image pyramid";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.group_id = stream.readUint32();
      this.num_entities_in_group = stream.readUint32();
      this.entity_ids = [];
      for (let i = 0; i < this.num_entities_in_group; i++) {
        const entity_id = stream.readUint32();
        this.entity_ids.push(entity_id);
      }
      this.tile_size_x = stream.readUint16();
      this.tile_size_y = stream.readUint16();
      this.layer_binning = [];
      this.tiles_in_layer_column_minus1 = [];
      this.tiles_in_layer_row_minus1 = [];
      for (let i = 0; i < this.num_entities_in_group; i++) {
        this.layer_binning[i] = stream.readUint16();
        this.tiles_in_layer_row_minus1[i] = stream.readUint16();
        this.tiles_in_layer_column_minus1[i] = stream.readUint16();
      }
    }
  }, _a185.fourcc = "pymd", _a185);
  var _a186;
  var fielBox = (_a186 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "FieldHandlingBox";
    }
    parse(stream) {
      this.fieldCount = stream.readUint8();
      this.fieldOrdering = stream.readUint8();
    }
  }, _a186.fourcc = "fiel", _a186);
  var _a187;
  var frmaBox = (_a187 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "OriginalFormatBox";
    }
    parse(stream) {
      this.data_format = stream.readString(4);
    }
  }, _a187.fourcc = "frma", _a187);
  var _a188;
  var imirBox = (_a188 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ImageMirror";
    }
    parse(stream) {
      const tmp = stream.readUint8();
      this.reserved = tmp >> 7;
      this.axis = tmp & 1;
    }
  }, _a188.fourcc = "imir", _a188);
  var _a189;
  var ipmaBox = (_a189 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ItemPropertyAssociationBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const entry_count = stream.readUint32();
      this.associations = [];
      for (let i = 0; i < entry_count; i++) {
        const id = this.version < 1 ? stream.readUint16() : stream.readUint32();
        const props = [];
        const association_count = stream.readUint8();
        for (let j = 0; j < association_count; j++) {
          const tmp = stream.readUint8();
          props.push({
            essential: (tmp & 128) >> 7 === 1,
            property_index: this.flags & 1 ? (tmp & 127) << 8 | stream.readUint8() : tmp & 127
          });
        }
        this.associations.push({
          id,
          props
        });
      }
    }
  }, _a189.fourcc = "ipma", _a189);
  var _a190;
  var irotBox = (_a190 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ImageRotation";
    }
    parse(stream) {
      this.angle = stream.readUint8() & 3;
    }
  }, _a190.fourcc = "irot", _a190);
  var _a191;
  var ispeBox = (_a191 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ImageSpatialExtentsProperty";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.image_width = stream.readUint32();
      this.image_height = stream.readUint32();
    }
  }, _a191.fourcc = "ispe", _a191);
  var _a192;
  var itaiBox = (_a192 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TAITimestampBox";
    }
    parse(stream) {
      this.TAI_timestamp = stream.readUint64();
      const status_bits = stream.readUint8();
      this.sychronization_state = status_bits >> 7 & 1;
      this.timestamp_generation_failure = status_bits >> 6 & 1;
      this.timestamp_is_modified = status_bits >> 5 & 1;
    }
  }, _a192.fourcc = "itai", _a192);
  var _a193;
  var kindBox = (_a193 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "KindBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.schemeURI = stream.readCString();
      if (!this.isEndOfBox(stream)) this.value = stream.readCString();
    }
    /** @bundle writing/kind.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = this.schemeURI.length + 1 + (this.value ? this.value.length + 1 : 0);
      this.writeHeader(stream);
      stream.writeCString(this.schemeURI);
      if (this.value) stream.writeCString(this.value);
    }
  }, _a193.fourcc = "kind", _a193);
  var _a194;
  var levaBox = (_a194 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "LevelAssignmentBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const count = stream.readUint8();
      this.levels = [];
      for (let i = 0; i < count; i++) {
        const level = {};
        this.levels[i] = level;
        level.track_ID = stream.readUint32();
        const tmp_byte = stream.readUint8();
        level.padding_flag = tmp_byte >> 7;
        level.assignment_type = tmp_byte & 127;
        switch (level.assignment_type) {
          case 0:
            level.grouping_type = stream.readString(4);
            break;
          case 1:
            level.grouping_type = stream.readString(4);
            level.grouping_type_parameter = stream.readUint32();
            break;
          case 2:
            break;
          case 3:
            break;
          case 4:
            level.sub_track_id = stream.readUint32();
            break;
          default:
            Log.warn("BoxParser", `Unknown level assignment type: ${level.assignment_type}`);
        }
      }
    }
  }, _a194.fourcc = "leva", _a194);
  var _a195;
  var lhvCBox = (_a195 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "LHEVCConfigurationBox";
    }
    parse(stream) {
      this.configurationVersion = stream.readUint8();
      this.min_spatial_segmentation_idc = stream.readUint16() & 4095;
      this.parallelismType = stream.readUint8() & 3;
      let tmp_byte = stream.readUint8();
      this.numTemporalLayers = (tmp_byte & 13) >> 3;
      this.temporalIdNested = (tmp_byte & 4) >> 2;
      this.lengthSizeMinusOne = tmp_byte & 3;
      this.nalu_arrays = [];
      const numOfArrays = stream.readUint8();
      for (let i = 0; i < numOfArrays; i++) {
        const nalu_array = [];
        this.nalu_arrays.push(nalu_array);
        tmp_byte = stream.readUint8();
        nalu_array.completeness = (tmp_byte & 128) >> 7;
        nalu_array.nalu_type = tmp_byte & 63;
        const numNalus = stream.readUint16();
        for (let j = 0; j < numNalus; j++) {
          const length = stream.readUint16();
          nalu_array.push({ data: stream.readUint8Array(length) });
        }
      }
    }
  }, _a195.fourcc = "lhvC", _a195);
  var _a196;
  var lselBox = (_a196 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "LayerSelectorProperty";
    }
    parse(stream) {
      this.layer_id = stream.readUint16();
    }
  }, _a196.fourcc = "lsel", _a196);
  var _a197;
  var maxrBox = (_a197 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintmaxrate";
    }
    parse(stream) {
      this.period = stream.readUint32();
      this.bytes = stream.readUint32();
    }
  }, _a197.fourcc = "maxr", _a197);
  var ColorPoint = class {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    toString() {
      return "(" + this.x + "," + this.y + ")";
    }
  };
  var _a198;
  var mdcvBox = (_a198 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "MasteringDisplayColourVolumeBox";
    }
    parse(stream) {
      this.display_primaries = [];
      this.display_primaries[0] = new ColorPoint(stream.readUint16(), stream.readUint16());
      this.display_primaries[1] = new ColorPoint(stream.readUint16(), stream.readUint16());
      this.display_primaries[2] = new ColorPoint(stream.readUint16(), stream.readUint16());
      this.white_point = new ColorPoint(stream.readUint16(), stream.readUint16());
      this.max_display_mastering_luminance = stream.readUint32();
      this.min_display_mastering_luminance = stream.readUint32();
    }
  }, _a198.fourcc = "mdcv", _a198);
  var _a199;
  var mfroBox = (_a199 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "MovieFragmentRandomAccessOffsetBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this._size = stream.readUint32();
    }
  }, _a199.fourcc = "mfro", _a199);
  var _a200;
  var mskCBox = (_a200 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "MaskConfigurationProperty";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.bits_per_pixel = stream.readUint8();
    }
  }, _a200.fourcc = "mskC", _a200);
  var _a201;
  var npckBox = (_a201 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintPacketsSent";
    }
    parse(stream) {
      this.packetssent = stream.readUint32();
    }
  }, _a201.fourcc = "npck", _a201);
  var _a202;
  var numpBox = (_a202 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintPacketsSent";
    }
    parse(stream) {
      this.packetssent = stream.readUint64();
    }
  }, _a202.fourcc = "nump", _a202);
  var PaddingBit = class {
    constructor(pad1, pad2) {
      this.pad1 = pad1;
      this.pad2 = pad2;
    }
  };
  var _a203;
  var padbBox = (_a203 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "PaddingBitsBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const sample_count = stream.readUint32();
      this.padbits = [];
      for (let i = 0; i < Math.floor((sample_count + 1) / 2); i++) {
        const bits = stream.readUint8();
        const pad1 = (bits & 112) >> 4;
        const pad2 = bits & 7;
        this.padbits.push(new PaddingBit(pad1, pad2));
      }
    }
  }, _a203.fourcc = "padb", _a203);
  var _a204;
  var paspBox = (_a204 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "PixelAspectRatioBox";
    }
    parse(stream) {
      this.hSpacing = stream.readUint32();
      this.vSpacing = stream.readUint32();
    }
  }, _a204.fourcc = "pasp", _a204);
  var _a205;
  var paylBox = (_a205 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CuePayloadBox";
    }
    parse(stream) {
      this.text = stream.readString(this.size - this.hdr_size);
    }
  }, _a205.fourcc = "payl", _a205);
  var _a206;
  var paytBox = (_a206 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintpayloadID";
    }
    parse(stream) {
      this.payloadID = stream.readUint32();
      const count = stream.readUint8();
      this.rtpmap_string = stream.readString(count);
    }
  }, _a206.fourcc = "payt", _a206);
  var _a207;
  var pdinBox = (_a207 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ProgressiveDownloadInfoBox";
      this.rate = [];
      this.initial_delay = [];
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const count = (this.size - this.hdr_size) / 8;
      for (let i = 0; i < count; i++) {
        this.rate[i] = stream.readUint32();
        this.initial_delay[i] = stream.readUint32();
      }
    }
  }, _a207.fourcc = "pdin", _a207);
  var _a208;
  var pixiBox = (_a208 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "PixelInformationProperty";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.num_channels = stream.readUint8();
      this.bits_per_channels = [];
      for (let i = 0; i < this.num_channels; i++) this.bits_per_channels[i] = stream.readUint8();
    }
  }, _a208.fourcc = "pixi", _a208);
  var _a209;
  var pmaxBox = (_a209 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintlargestpacket";
    }
    parse(stream) {
      this.bytes = stream.readUint32();
    }
  }, _a209.fourcc = "pmax", _a209);
  var _a210;
  var prdiBox = (_a210 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ProgressiveDerivedImageItemInformationProperty";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.step_count = stream.readUint16();
      this.item_count = [];
      if (this.flags & 2) for (let i = 0; i < this.step_count; i++) this.item_count[i] = stream.readUint16();
    }
  }, _a210.fourcc = "prdi", _a210);
  var _a211;
  var prfrBox = (_a211 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ProjectionFormatBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.projection_type = stream.readUint8() & 31;
    }
  }, _a211.fourcc = "prfr", _a211);
  var _a212;
  var prftBox = (_a212 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ProducerReferenceTimeBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.ref_track_id = stream.readUint32();
      this.ntp_timestamp = stream.readUint64();
      if (this.version === 0) this.media_time = stream.readUint32();
      else this.media_time = stream.readUint64();
    }
  }, _a212.fourcc = "prft", _a212);
  var _a213;
  var psshBox = (_a213 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ProtectionSystemSpecificHeaderBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.system_id = parseHex16(stream);
      this.kid = [];
      if (this.version > 0) {
        const count = stream.readUint32();
        for (let i = 0; i < count; i++) this.kid[i] = parseHex16(stream);
      }
      const datasize = stream.readUint32();
      if (datasize > 0) this.protection_data = stream.readUint8Array(datasize);
    }
  }, _a213.fourcc = "pssh", _a213);
  var _a214;
  var clefBox = (_a214 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackCleanApertureDimensionsBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.width = stream.readUint32();
      this.height = stream.readUint32();
    }
  }, _a214.fourcc = "clef", _a214);
  function parseItifData(type, data) {
    if (type === dataBox.Types.UTF8) return new TextDecoder("utf-8").decode(data);
    const view = new DataView(data.buffer);
    if (type === dataBox.Types.BE_UNSIGNED_INT) if (data.length === 1) return view.getUint8(0);
    else if (data.length === 2) return view.getUint16(0, false);
    else if (data.length === 4) return view.getUint32(0, false);
    else if (data.length === 8) return view.getBigUint64(0, false);
    else throw new Error("Unsupported ITIF_TYPE_BE_UNSIGNED_INT length " + data.length);
    else if (type === dataBox.Types.BE_SIGNED_INT) if (data.length === 1) return view.getInt8(0);
    else if (data.length === 2) return view.getInt16(0, false);
    else if (data.length === 4) return view.getInt32(0, false);
    else if (data.length === 8) return view.getBigInt64(0, false);
    else throw new Error("Unsupported ITIF_TYPE_BE_SIGNED_INT length " + data.length);
    else if (type === dataBox.Types.BE_FLOAT32) return view.getFloat32(0, false);
    Log.warn("DataBox", "Unsupported or unimplemented itif data type: " + type);
  }
  var _a215;
  var dataBox = (_a215 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "DataBox";
    }
    parse(stream) {
      this.valueType = stream.readUint32();
      this.country = stream.readUint16();
      if (this.country > 255) {
        stream.seek(stream.getPosition() - 2);
        this.countryString = stream.readString(2);
      }
      this.language = stream.readUint16();
      if (this.language > 255) {
        stream.seek(stream.getPosition() - 2);
        this.parseLanguage(stream);
      }
      this.raw = stream.readUint8Array(this.size - this.hdr_size - 8);
      this.value = parseItifData(this.valueType, this.raw);
    }
  }, _a215.fourcc = "data", _a215.Types = {
    RESERVED: 0,
    UTF8: 1,
    UTF16: 2,
    SJIS: 3,
    UTF8_SORT: 4,
    UTF16_SORT: 5,
    JPEG: 13,
    PNG: 14,
    BE_SIGNED_INT: 21,
    BE_UNSIGNED_INT: 22,
    BE_FLOAT32: 23,
    BE_FLOAT64: 24,
    BMP: 27,
    QT_ATOM: 28,
    BE_SIGNED_INT8: 65,
    BE_SIGNED_INT16: 66,
    BE_SIGNED_INT32: 67,
    BE_FLOAT32_POINT: 70,
    BE_FLOAT32_DIMENSIONS: 71,
    BE_FLOAT32_RECT: 72,
    BE_SIGNED_INT64: 74,
    BE_UNSIGNED_INT8: 75,
    BE_UNSIGNED_INT16: 76,
    BE_UNSIGNED_INT32: 77,
    BE_UNSIGNED_INT64: 78,
    BE_FLOAT64_AFFINE_TRANSFORM: 79
  }, _a215);
  var _a216;
  var enofBox = (_a216 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackEncodedPixelsDimensionsBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.width = stream.readUint32();
      this.height = stream.readUint32();
    }
  }, _a216.fourcc = "enof", _a216);
  var _a217;
  var ilstBox = (_a217 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "IlstBox";
    }
    parse(stream) {
      this.list = {};
      let total = this.size - this.hdr_size;
      while (total > 0) {
        const size = stream.readUint32();
        const index = stream.readUint32();
        const res = parseOneBox(stream, false, size - 8);
        if (res.code === 1) this.list[index] = res.box;
        total -= size;
      }
    }
  }, _a217.fourcc = "ilst", _a217);
  var _a218;
  var keysBox = (_a218 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "KeysBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.count = stream.readUint32();
      this.keys = {};
      for (let i = 0; i < this.count; i++) {
        const len = stream.readUint32();
        this.keys[i + 1] = stream.readString(len - 4);
      }
    }
  }, _a218.fourcc = "keys", _a218);
  var _a219;
  var profBox = (_a219 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackProductionApertureDimensionsBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.width = stream.readUint32();
      this.height = stream.readUint32();
    }
  }, _a219.fourcc = "prof", _a219);
  var _a220;
  var taptBox = (_a220 = class extends ContainerBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackApertureModeDimensionsBox";
      this.clefs = [];
      this.profs = [];
      this.enofs = [];
      this.subBoxNames = [
        "clef",
        "prof",
        "enof"
      ];
    }
  }, _a220.fourcc = "tapt", _a220);
  var _a221;
  var rtp_Box = (_a221 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "rtpmoviehintinformation";
    }
    parse(stream) {
      this.descriptionformat = stream.readString(4);
      this.sdptext = stream.readString(this.size - this.hdr_size - 4);
    }
  }, _a221.fourcc = "rtp ", _a221);
  var _a222;
  var saioBox = (_a222 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SampleAuxiliaryInformationOffsetsBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.flags & 1) {
        this.aux_info_type = stream.readString(4);
        this.aux_info_type_parameter = stream.readUint32();
      }
      this.entry_count = stream.readUint32();
      this.offset = [];
      for (let i = 0; i < this.entry_count; i++) if (this.version === 0) this.offset[i] = stream.readUint32();
      else this.offset[i] = stream.readUint64();
    }
  }, _a222.fourcc = "saio", _a222);
  var _a223;
  var saizBox = (_a223 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SampleAuxiliaryInformationSizesBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.flags & 1) {
        this.aux_info_type = stream.readString(4);
        this.aux_info_type_parameter = stream.readUint32();
      }
      this.default_sample_info_size = stream.readUint8();
      this.sample_count = stream.readUint32();
      this.sample_info_size = [];
      if (this.default_sample_info_size === 0) for (let i = 0; i < this.sample_count; i++) this.sample_info_size[i] = stream.readUint8();
    }
  }, _a223.fourcc = "saiz", _a223);
  var Pixel = class {
    constructor(bad_pixel_row, bad_pixel_column) {
      this.bad_pixel_row = bad_pixel_row;
      this.bad_pixel_column = bad_pixel_column;
    }
    toString() {
      return "[row: " + this.bad_pixel_row + ", column: " + this.bad_pixel_column + "]";
    }
  };
  var _a224;
  var sbpmBox = (_a224 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SensorBadPixelsMapBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.component_count = stream.readUint16();
      this.component_index = [];
      for (let i = 0; i < this.component_count; i++) this.component_index.push(stream.readUint16());
      const flags = stream.readUint8();
      this.correction_applied = 128 === (flags & 128);
      this.num_bad_rows = stream.readUint32();
      this.num_bad_cols = stream.readUint32();
      this.num_bad_pixels = stream.readUint32();
      this.bad_rows = [];
      this.bad_columns = [];
      this.bad_pixels = [];
      for (let i = 0; i < this.num_bad_rows; i++) this.bad_rows.push(stream.readUint32());
      for (let i = 0; i < this.num_bad_cols; i++) this.bad_columns.push(stream.readUint32());
      for (let i = 0; i < this.num_bad_pixels; i++) {
        const row = stream.readUint32();
        const col = stream.readUint32();
        this.bad_pixels.push(new Pixel(row, col));
      }
    }
  }, _a224.fourcc = "sbpm", _a224);
  var _a225;
  var schmBox = (_a225 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SchemeTypeBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.scheme_type = stream.readString(4);
      this.scheme_version = stream.readUint32();
      if (this.flags & 1) this.scheme_uri = stream.readString(this.size - this.hdr_size - 8);
    }
  }, _a225.fourcc = "schm", _a225);
  var _a226;
  var sdp_Box = (_a226 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "rtptracksdphintinformation";
    }
    parse(stream) {
      this.sdptext = stream.readString(this.size - this.hdr_size);
    }
  }, _a226.fourcc = "sdp ", _a226);
  var _a227;
  var sencBox = (_a227 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SampleEncryptionBox";
    }
  }, _a227.fourcc = "senc", _a227);
  var _a228;
  var SmDmBox = (_a228 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SMPTE2086MasteringDisplayMetadataBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.primaryRChromaticity_x = stream.readUint16();
      this.primaryRChromaticity_y = stream.readUint16();
      this.primaryGChromaticity_x = stream.readUint16();
      this.primaryGChromaticity_y = stream.readUint16();
      this.primaryBChromaticity_x = stream.readUint16();
      this.primaryBChromaticity_y = stream.readUint16();
      this.whitePointChromaticity_x = stream.readUint16();
      this.whitePointChromaticity_y = stream.readUint16();
      this.luminanceMax = stream.readUint32();
      this.luminanceMin = stream.readUint32();
    }
  }, _a228.fourcc = "SmDm", _a228);
  var _a229;
  var sratBox = (_a229 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SamplingRateBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.sampling_rate = stream.readUint32();
    }
  }, _a229.fourcc = "srat", _a229);
  var _a230;
  var stdpBox = (_a230 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "DegradationPriorityBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const count = (this.size - this.hdr_size) / 2;
      this.priority = [];
      for (let i = 0; i < count; i++) this.priority[i] = stream.readUint16();
    }
  }, _a230.fourcc = "stdp", _a230);
  var _a231;
  var striBox = (_a231 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SubTrackInformationBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.switch_group = stream.readUint16();
      this.alternate_group = stream.readUint16();
      this.sub_track_id = stream.readUint32();
      const count = (this.size - this.hdr_size - 8) / 4;
      this.attribute_list = [];
      for (let i = 0; i < count; i++) this.attribute_list[i] = stream.readUint32();
    }
  }, _a231.fourcc = "stri", _a231);
  var _a232;
  var stsgBox = (_a232 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SubTrackSampleGroupBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.grouping_type = stream.readUint32();
      const count = stream.readUint16();
      this.group_description_index = [];
      for (let i = 0; i < count; i++) this.group_description_index[i] = stream.readUint32();
    }
  }, _a232.fourcc = "stsg", _a232);
  var _a233;
  var stshBox = (_a233 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "ShadowSyncSampleBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const entry_count = stream.readUint32();
      this.shadowed_sample_numbers = [];
      this.sync_sample_numbers = [];
      if (this.version === 0) for (let i = 0; i < entry_count; i++) {
        this.shadowed_sample_numbers.push(stream.readUint32());
        this.sync_sample_numbers.push(stream.readUint32());
      }
    }
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 8 * this.shadowed_sample_numbers.length;
      this.writeHeader(stream);
      stream.writeUint32(this.shadowed_sample_numbers.length);
      for (let i = 0; i < this.shadowed_sample_numbers.length; i++) {
        stream.writeUint32(this.shadowed_sample_numbers[i]);
        stream.writeUint32(this.sync_sample_numbers[i]);
      }
    }
  }, _a233.fourcc = "stsh", _a233);
  var _a234;
  var stssBox = (_a234 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SyncSampleBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const entry_count = stream.readUint32();
      if (this.version === 0) {
        this.sample_numbers = [];
        for (let i = 0; i < entry_count; i++) this.sample_numbers.push(stream.readUint32());
      }
    }
    /** @bundle writing/stss.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 4 * this.sample_numbers.length;
      this.writeHeader(stream);
      stream.writeUint32(this.sample_numbers.length);
      stream.writeUint32Array(this.sample_numbers);
    }
  }, _a234.fourcc = "stss", _a234);
  var _a235;
  var stviBox = (_a235 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "StereoVideoBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const tmp32 = stream.readUint32();
      this.single_view_allowed = tmp32 & 3;
      this.stereo_scheme = stream.readUint32();
      const length = stream.readUint32();
      this.stereo_indication_type = stream.readString(length);
      this.boxes = [];
      while (stream.getPosition() < this.start + this.size) {
        const ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret.code === 1) {
          const box2 = ret.box;
          this.boxes.push(box2);
          this[box2.type] = box2;
        } else return;
      }
    }
  }, _a235.fourcc = "stvi", _a235);
  var _a236;
  var stz2Box = (_a236 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "CompactSampleSizeBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.sample_sizes = [];
      if (this.version === 0) {
        this.reserved = stream.readUint24();
        this.field_size = stream.readUint8();
        const sample_count = stream.readUint32();
        if (this.field_size === 4) for (let i = 0; i < sample_count; i += 2) {
          const tmp = stream.readUint8();
          this.sample_sizes[i] = tmp >> 4 & 15;
          this.sample_sizes[i + 1] = tmp & 15;
        }
        else if (this.field_size === 8) for (let i = 0; i < sample_count; i++) this.sample_sizes[i] = stream.readUint8();
        else if (this.field_size === 16) for (let i = 0; i < sample_count; i++) this.sample_sizes[i] = stream.readUint16();
        else Log.error("BoxParser", "Error in length field in stz2 box", stream.isofile);
      }
    }
  }, _a236.fourcc = "stz2", _a236);
  var _a237;
  var subsBox = (_a237 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "SubSampleInformationBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const entry_count = stream.readUint32();
      this.entries = [];
      let subsample_count;
      for (let i = 0; i < entry_count; i++) {
        const sampleInfo = {};
        this.entries[i] = sampleInfo;
        sampleInfo.sample_delta = stream.readUint32();
        sampleInfo.subsamples = [];
        subsample_count = stream.readUint16();
        if (subsample_count > 0) for (let j = 0; j < subsample_count; j++) {
          const subsample = {};
          sampleInfo.subsamples.push(subsample);
          if (this.version === 1) subsample.size = stream.readUint32();
          else subsample.size = stream.readUint16();
          subsample.priority = stream.readUint8();
          subsample.discardable = stream.readUint8();
          subsample.codec_specific_parameters = stream.readUint32();
        }
      }
    }
  }, _a237.fourcc = "subs", _a237);
  var _a238;
  var taicBox = (_a238 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TAIClockInfoBox";
    }
    parse(stream) {
      this.time_uncertainty = stream.readUint64();
      this.clock_resolution = stream.readUint32();
      this.clock_drift_rate = stream.readInt32();
      const reserved_byte = stream.readUint8();
      this.clock_type = (reserved_byte & 192) >> 6;
    }
  }, _a238.fourcc = "taic", _a238);
  var _a239;
  var tencBox = (_a239 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackEncryptionBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      stream.readUint8();
      if (this.version === 0) stream.readUint8();
      else {
        const tmp = stream.readUint8();
        this.default_crypt_byte_block = tmp >> 4 & 15;
        this.default_skip_byte_block = tmp & 15;
      }
      this.default_isProtected = stream.readUint8();
      this.default_Per_Sample_IV_Size = stream.readUint8();
      this.default_KID = parseHex16(stream);
      if (this.default_isProtected === 1 && this.default_Per_Sample_IV_Size === 0) {
        this.default_constant_IV_size = stream.readUint8();
        this.default_constant_IV = stream.readUint8Array(this.default_constant_IV_size);
      }
    }
  }, _a239.fourcc = "tenc", _a239);
  var TfraEntry = class {
  };
  var _a240;
  var tfraBox = (_a240 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackFragmentRandomAccessBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.track_ID = stream.readUint32();
      stream.readUint24();
      const tmp_byte = stream.readUint8();
      this.length_size_of_traf_num = tmp_byte >> 4 & 3;
      this.length_size_of_trun_num = tmp_byte >> 2 & 3;
      this.length_size_of_sample_num = tmp_byte & 3;
      this.entries = [];
      const number_of_entries = stream.readUint32();
      for (let i = 0; i < number_of_entries; i++) {
        const entry = new TfraEntry();
        if (this.version === 1) {
          entry.time = stream.readUint64();
          entry.moof_offset = stream.readUint64();
        } else {
          entry.time = stream.readUint32();
          entry.moof_offset = stream.readUint32();
        }
        entry.traf_number = stream["readUint" + 8 * (this.length_size_of_traf_num + 1)]();
        entry.trun_number = stream["readUint" + 8 * (this.length_size_of_trun_num + 1)]();
        entry.sample_delta = stream["readUint" + 8 * (this.length_size_of_sample_num + 1)]();
        this.entries.push(entry);
      }
    }
  }, _a240.fourcc = "tfra", _a240);
  var _a241;
  var tmaxBox = (_a241 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintmaxrelativetime";
    }
    parse(stream) {
      this.time = stream.readUint32();
    }
  }, _a241.fourcc = "tmax", _a241);
  var _a242;
  var tminBox = (_a242 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintminrelativetime";
    }
    parse(stream) {
      this.time = stream.readUint32();
    }
  }, _a242.fourcc = "tmin", _a242);
  var _a243;
  var totlBox = (_a243 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintBytesSent";
    }
    parse(stream) {
      this.bytessent = stream.readUint32();
    }
  }, _a243.fourcc = "totl", _a243);
  var _a244;
  var tpayBox = (_a244 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintBytesSent";
    }
    parse(stream) {
      this.bytessent = stream.readUint32();
    }
  }, _a244.fourcc = "tpay", _a244);
  var _a245;
  var tpylBox = (_a245 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintBytesSent";
    }
    parse(stream) {
      this.bytessent = stream.readUint64();
    }
  }, _a245.fourcc = "tpyl", _a245);
  var _a246;
  var msrcTrackGroupTypeBox = (_a246 = class extends TrackGroupTypeBox {
  }, _a246.fourcc = "msrc", _a246);
  var _a247;
  var trefBox = (_a247 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackReferenceBox";
      this.references = [];
    }
    parse(stream) {
      while (stream.getPosition() < this.start + this.size) {
        const ret = parseOneBox(stream, true, this.size - (stream.getPosition() - this.start));
        if (ret.code === 1) {
          if (!_a247.allowed_types.includes(ret.type)) Log.warn("BoxParser", `Unknown track reference type: '${ret.type}'`);
          const box2 = new TrackReferenceTypeBox(ret.type, ret.size, ret.hdr_size, ret.start);
          if (box2.write === Box.prototype.write && box2.type !== "mdat") {
            Log.info("BoxParser", "TrackReference " + box2.type + " box writing not yet implemented, keeping unparsed data in memory for later write");
            box2.parseDataAndRewind(stream);
          }
          box2.parse(stream);
          this.references.push(box2);
        } else return;
      }
    }
  }, _a247.fourcc = "tref", _a247.allowed_types = [
    "hint",
    "cdsc",
    "font",
    "hind",
    "vdep",
    "vplx",
    "subt",
    "thmb",
    "auxl",
    "cdtg",
    "shsc",
    "aest"
  ], _a247);
  var _a248;
  var trepBox = (_a248 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackExtensionPropertiesBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.track_ID = stream.readUint32();
      this.boxes = [];
      while (stream.getPosition() < this.start + this.size) {
        const ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret.code === 1) {
          const box2 = ret.box;
          this.boxes.push(box2);
        } else return;
      }
    }
  }, _a248.fourcc = "trep", _a248);
  var _a249;
  var trpyBox = (_a249 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "hintBytesSent";
    }
    parse(stream) {
      this.bytessent = stream.readUint64();
    }
  }, _a249.fourcc = "trpy", _a249);
  var _a250;
  var tselBox = (_a250 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TrackSelectionBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.switch_group = stream.readUint32();
      const count = (this.size - this.hdr_size - 4) / 4;
      this.attribute_list = [];
      for (let i = 0; i < count; i++) this.attribute_list[i] = stream.readUint32();
    }
  }, _a250.fourcc = "tsel", _a250);
  var _a251;
  var txtcBox = (_a251 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TextConfigBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.config = stream.readCString();
    }
  }, _a251.fourcc = "txtc", _a251);
  var _a252;
  var tycoBox = (_a252 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "TypeCombinationBox";
    }
    parse(stream) {
      const count = (this.size - this.hdr_size) / 4;
      this.compatible_brands = [];
      for (let i = 0; i < count; i++) this.compatible_brands[i] = stream.readString(4);
    }
  }, _a252.fourcc = "tyco", _a252);
  var _a253;
  var udesBox = (_a253 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "UserDescriptionProperty";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.lang = stream.readCString();
      this.name = stream.readCString();
      this.description = stream.readCString();
      this.tags = stream.readCString();
    }
  }, _a253.fourcc = "udes", _a253);
  var _a254;
  var uncCBox = (_a254 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "UncompressedFrameConfigBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.profile = stream.readString(4);
      if (this.version === 1) {
      } else if (this.version === 0) {
        this.component_count = stream.readUint32();
        this.component_index = [];
        this.component_bit_depth_minus_one = [];
        this.component_format = [];
        this.component_align_size = [];
        for (let i = 0; i < this.component_count; i++) {
          this.component_index.push(stream.readUint16());
          this.component_bit_depth_minus_one.push(stream.readUint8());
          this.component_format.push(stream.readUint8());
          this.component_align_size.push(stream.readUint8());
        }
        this.sampling_type = stream.readUint8();
        this.interleave_type = stream.readUint8();
        this.block_size = stream.readUint8();
        const flags = stream.readUint8();
        this.component_little_endian = flags >> 7 & 1;
        this.block_pad_lsb = flags >> 6 & 1;
        this.block_little_endian = flags >> 5 & 1;
        this.block_reversed = flags >> 4 & 1;
        this.pad_unknown = flags >> 3 & 1;
        this.pixel_size = stream.readUint32();
        this.row_align_size = stream.readUint32();
        this.tile_align_size = stream.readUint32();
        this.num_tile_cols_minus_one = stream.readUint32();
        this.num_tile_rows_minus_one = stream.readUint32();
      }
    }
  }, _a254.fourcc = "uncC", _a254);
  var _a255;
  var urnBox = (_a255 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "DataEntryUrnBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.name = stream.readCString();
      if (this.size - this.hdr_size - this.name.length - 1 > 0) this.location = stream.readCString();
    }
    /** @bundle writing/urn.js */
    write(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = this.name.length + 1 + (this.location ? this.location.length + 1 : 0);
      this.writeHeader(stream);
      stream.writeCString(this.name);
      if (this.location) stream.writeCString(this.location);
    }
  }, _a255.fourcc = "urn ", _a255);
  var _a256;
  var vttCBox = (_a256 = class extends Box {
    constructor(..._args) {
      super(..._args);
      this.box_name = "WebVTTConfigurationBox";
    }
    parse(stream) {
      this.text = stream.readString(this.size - this.hdr_size);
    }
  }, _a256.fourcc = "vttC", _a256);
  var _a257;
  var vvnCBox = (_a257 = class extends FullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "VvcNALUConfigBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      const tmp = stream.readUint8();
      this.lengthSizeMinusOne = tmp & 3;
    }
  }, _a257.fourcc = "vvnC", _a257);
  var _a258;
  var alstSampleGroupEntry = (_a258 = class extends SampleGroupEntry {
    parse(stream) {
      const roll_count = stream.readUint16();
      this.first_output_sample = stream.readUint16();
      this.sample_offset = [];
      for (let i = 0; i < roll_count; i++) this.sample_offset[i] = stream.readUint32();
      const remaining = this.description_length - 4 - 4 * roll_count;
      this.num_output_samples = [];
      this.num_total_samples = [];
      for (let i = 0; i < remaining / 4; i++) {
        this.num_output_samples[i] = stream.readUint16();
        this.num_total_samples[i] = stream.readUint16();
      }
    }
  }, _a258.grouping_type = "alst", _a258);
  var _a259;
  var avllSampleGroupEntry = (_a259 = class extends SampleGroupEntry {
    parse(stream) {
      this.layerNumber = stream.readUint8();
      this.accurateStatisticsFlag = stream.readUint8();
      this.avgBitRate = stream.readUint16();
      this.avgFrameRate = stream.readUint16();
    }
  }, _a259.grouping_type = "avll", _a259);
  var _a260;
  var avssSampleGroupEntry = (_a260 = class extends SampleGroupEntry {
    parse(stream) {
      this.subSequenceIdentifier = stream.readUint16();
      this.layerNumber = stream.readUint8();
      const tmp_byte = stream.readUint8();
      this.durationFlag = tmp_byte >> 7;
      this.avgRateFlag = tmp_byte >> 6 & 1;
      if (this.durationFlag) this.duration = stream.readUint32();
      if (this.avgRateFlag) {
        this.accurateStatisticsFlag = stream.readUint8();
        this.avgBitRate = stream.readUint16();
        this.avgFrameRate = stream.readUint16();
      }
      this.dependency = [];
      const numReferences = stream.readUint8();
      for (let i = 0; i < numReferences; i++) this.dependency.push({
        subSeqDirectionFlag: stream.readUint8(),
        layerNumber: stream.readUint8(),
        subSequenceIdentifier: stream.readUint16()
      });
    }
  }, _a260.grouping_type = "avss", _a260);
  var _a261;
  var dtrtSampleGroupEntry = (_a261 = class extends SampleGroupEntry {
    parse(_stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    }
  }, _a261.grouping_type = "dtrt", _a261);
  var _a262;
  var mvifSampleGroupEntry = (_a262 = class extends SampleGroupEntry {
    parse(_stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    }
  }, _a262.grouping_type = "mvif", _a262);
  var _a263;
  var prolSampleGroupEntry = (_a263 = class extends SampleGroupEntry {
    parse(stream) {
      this.roll_distance = stream.readInt16();
    }
  }, _a263.grouping_type = "prol", _a263);
  var _a264;
  var rapSampleGroupEntry = (_a264 = class extends SampleGroupEntry {
    parse(stream) {
      const tmp_byte = stream.readUint8();
      this.num_leading_samples_known = tmp_byte >> 7;
      this.num_leading_samples = tmp_byte & 127;
    }
  }, _a264.grouping_type = "rap ", _a264);
  var _a265;
  var rashSampleGroupEntry = (_a265 = class extends SampleGroupEntry {
    parse(stream) {
      this.operation_point_count = stream.readUint16();
      if (this.description_length !== 2 + (this.operation_point_count === 1 ? 2 : this.operation_point_count * 6) + 9) {
        Log.warn("BoxParser", "Mismatch in " + this.grouping_type + " sample group length");
        this.data = stream.readUint8Array(this.description_length - 2);
      } else {
        if (this.operation_point_count === 1) this.target_rate_share = stream.readUint16();
        else {
          this.target_rate_share = [];
          this.available_bitrate = [];
          for (let i = 0; i < this.operation_point_count; i++) {
            this.available_bitrate[i] = stream.readUint32();
            this.target_rate_share[i] = stream.readUint16();
          }
        }
        this.maximum_bitrate = stream.readUint32();
        this.minimum_bitrate = stream.readUint32();
        this.discard_priority = stream.readUint8();
      }
    }
  }, _a265.grouping_type = "rash", _a265);
  var _a266;
  var rollSampleGroupEntry = (_a266 = class extends SampleGroupEntry {
    parse(stream) {
      this.roll_distance = stream.readInt16();
    }
  }, _a266.grouping_type = "roll", _a266);
  var _a267;
  var scifSampleGroupEntry = (_a267 = class extends SampleGroupEntry {
    parse(_stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    }
  }, _a267.grouping_type = "scif", _a267);
  var _a268;
  var scnmSampleGroupEntry = (_a268 = class extends SampleGroupEntry {
    parse(_stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    }
  }, _a268.grouping_type = "scnm", _a268);
  var _a269;
  var seigSampleGroupEntry = (_a269 = class extends SampleGroupEntry {
    parse(stream) {
      this.reserved = stream.readUint8();
      const tmp = stream.readUint8();
      this.crypt_byte_block = tmp >> 4;
      this.skip_byte_block = tmp & 15;
      this.isProtected = stream.readUint8();
      this.Per_Sample_IV_Size = stream.readUint8();
      this.KID = parseHex16(stream);
      this.constant_IV_size = 0;
      this.constant_IV = 0;
      if (this.isProtected === 1 && this.Per_Sample_IV_Size === 0) {
        this.constant_IV_size = stream.readUint8();
        this.constant_IV = stream.readUint8Array(this.constant_IV_size);
      }
    }
  }, _a269.grouping_type = "seig", _a269);
  var _a270;
  var stsaSampleGroupEntry = (_a270 = class extends SampleGroupEntry {
    parse(_stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    }
  }, _a270.grouping_type = "stsa", _a270);
  var _a271;
  var syncSampleGroupEntry = (_a271 = class extends SampleGroupEntry {
    parse(stream) {
      const tmp_byte = stream.readUint8();
      this.NAL_unit_type = tmp_byte & 63;
    }
  }, _a271.grouping_type = "sync", _a271);
  var _a272;
  var teleSampleGroupEntry = (_a272 = class extends SampleGroupEntry {
    parse(stream) {
      const tmp_byte = stream.readUint8();
      this.level_independently_decodable = tmp_byte >> 7;
    }
  }, _a272.grouping_type = "tele", _a272);
  var _a273;
  var tsasSampleGroupEntry = (_a273 = class extends SampleGroupEntry {
    parse(_stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    }
  }, _a273.grouping_type = "tsas", _a273);
  var _a274;
  var tsclSampleGroupEntry = (_a274 = class extends SampleGroupEntry {
    parse(_stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    }
  }, _a274.grouping_type = "tscl", _a274);
  var _a275;
  var viprSampleGroupEntry = (_a275 = class extends SampleGroupEntry {
    parse(_stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    }
  }, _a275.grouping_type = "vipr", _a275);
  var _a276;
  var UUIDBox = (_a276 = class extends Box {
  }, _a276.fourcc = "uuid", _a276);
  var _a277;
  var UUIDFullBox = (_a277 = class extends FullBox {
  }, _a277.fourcc = "uuid", _a277);
  var _a278;
  var piffLsmBox = (_a278 = class extends UUIDFullBox {
    constructor(..._args) {
      super(..._args);
      this.box_name = "LiveServerManifestBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.LiveServerManifest = stream.readString(this.size - this.hdr_size).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
  }, _a278.uuid = "a5d40b30e81411ddba2f0800200c9a66", _a278);
  var _a279;
  var piffPsshBox = (_a279 = class extends UUIDFullBox {
    constructor(..._args2) {
      super(..._args2);
      this.box_name = "PiffProtectionSystemSpecificHeaderBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.system_id = parseHex16(stream);
      const datasize = stream.readUint32();
      if (datasize > 0) this.data = stream.readUint8Array(datasize);
    }
  }, _a279.uuid = "d08a4f1810f34a82b6c832d8aba183d3", _a279);
  var _a280;
  var piffSencBox = (_a280 = class extends UUIDFullBox {
    constructor(..._args3) {
      super(..._args3);
      this.box_name = "PiffSampleEncryptionBox";
    }
  }, _a280.uuid = "a2394f525a9b4f14a2446c427c648df4", _a280);
  var _a281;
  var piffTencBox = (_a281 = class extends UUIDFullBox {
    constructor(..._args4) {
      super(..._args4);
      this.box_name = "PiffTrackEncryptionBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.default_AlgorithmID = stream.readUint24();
      this.default_IV_size = stream.readUint8();
      this.default_KID = parseHex16(stream);
    }
  }, _a281.uuid = "8974dbce7be74c5184f97148f9882554", _a281);
  var _a282;
  var piffTfrfBox = (_a282 = class extends UUIDFullBox {
    constructor(..._args5) {
      super(..._args5);
      this.box_name = "TfrfBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      this.fragment_count = stream.readUint8();
      this.entries = [];
      for (let i = 0; i < this.fragment_count; i++) {
        let absolute_time = 0;
        let absolute_duration = 0;
        if (this.version === 1) {
          absolute_time = stream.readUint64();
          absolute_duration = stream.readUint64();
        } else {
          absolute_time = stream.readUint32();
          absolute_duration = stream.readUint32();
        }
        this.entries.push({
          absolute_time,
          absolute_duration
        });
      }
    }
  }, _a282.uuid = "d4807ef2ca3946958e5426cb9e46a79f", _a282);
  var _a283;
  var piffTfxdBox = (_a283 = class extends UUIDFullBox {
    constructor(..._args6) {
      super(..._args6);
      this.box_name = "TfxdBox";
    }
    parse(stream) {
      this.parseFullHeader(stream);
      if (this.version === 1) {
        this.absolute_time = stream.readUint64();
        this.duration = stream.readUint64();
      } else {
        this.absolute_time = stream.readUint32();
        this.duration = stream.readUint32();
      }
    }
  }, _a283.uuid = "6d1d9b0542d544e680e2141daff757b2", _a283);
  var _a284;
  var ItemContentIDPropertyBox = (_a284 = class extends UUIDBox {
    constructor(..._args7) {
      super(..._args7);
      this.box_name = "ItemContentIDProperty";
    }
    parse(stream) {
      this.content_id = stream.readCString();
    }
  }, _a284.uuid = "261ef3741d975bbaacbd9d2c8ea73522", _a284);
  var _a285;
  var ItemComponentContentIDPropertyBox = (_a285 = class extends UUIDBox {
    constructor(..._args8) {
      super(..._args8);
      this.box_name = "ItemComponentContentIDProperty";
    }
    parse(stream) {
      this.number_of_components = stream.readUint32();
      this.content_ids = [];
      for (let i = 0; i < this.number_of_components; i++) {
        const content_id = stream.readCString();
        this.content_ids.push(content_id);
      }
    }
  }, _a285.uuid = "9db9dd6e373c5a4e811021fc83a911fd", _a285);
  var all_boxes_exports = /* @__PURE__ */ __exportAll({
    CoLLBox: () => CoLLBox,
    ItemComponentContentIDPropertyBox: () => ItemComponentContentIDPropertyBox,
    ItemContentIDPropertyBox: () => ItemContentIDPropertyBox,
    OpusSampleEntry: () => OpusSampleEntry,
    SmDmBox: () => SmDmBox,
    a1lxBox: () => a1lxBox,
    a1opBox: () => a1opBox,
    ac_3SampleEntry: () => ac_3SampleEntry,
    ac_4SampleEntry: () => ac_4SampleEntry,
    aebrBox: () => aebrBox,
    afbrBox: () => afbrBox,
    albcBox: () => albcBox,
    alstSampleGroupEntry: () => alstSampleGroupEntry,
    altrBox: () => altrBox,
    auxCBox: () => auxCBox,
    av01SampleEntry: () => av01SampleEntry,
    av1CBox: () => av1CBox,
    avc1SampleEntry: () => avc1SampleEntry,
    avc2SampleEntry: () => avc2SampleEntry,
    avc3SampleEntry: () => avc3SampleEntry,
    avc4SampleEntry: () => avc4SampleEntry,
    avcCBox: () => avcCBox,
    avllSampleGroupEntry: () => avllSampleGroupEntry,
    avs3SampleEntry: () => avs3SampleEntry,
    avssSampleGroupEntry: () => avssSampleGroupEntry,
    brstBox: () => brstBox,
    btrtBox: () => btrtBox,
    bxmlBox: () => bxmlBox,
    ccstBox: () => ccstBox,
    cdefBox: () => cdefBox,
    clapBox: () => clapBox,
    clefBox: () => clefBox,
    clliBox: () => clliBox,
    cmexBox: () => cmexBox,
    cminBox: () => cminBox,
    cmpCBox: () => cmpCBox,
    cmpdBox: () => cmpdBox,
    co64Box: () => co64Box,
    colrBox: () => colrBox,
    coviBox: () => coviBox,
    cprtBox: () => cprtBox,
    cschBox: () => cschBox,
    cslgBox: () => cslgBox,
    cttsBox: () => cttsBox,
    dOpsBox: () => dOpsBox,
    dac3Box: () => dac3Box,
    dataBox: () => dataBox,
    dav1SampleEntry: () => dav1SampleEntry,
    dec3Box: () => dec3Box,
    dfLaBox: () => dfLaBox,
    dimmBox: () => dimmBox,
    dinfBox: () => dinfBox,
    dmax: () => dmax,
    dmedBox: () => dmedBox,
    dobrBox: () => dobrBox,
    drefBox: () => drefBox,
    drepBox: () => drepBox,
    dtrtSampleGroupEntry: () => dtrtSampleGroupEntry,
    dvh1SampleEntry: () => dvh1SampleEntry,
    dvheSampleEntry: () => dvheSampleEntry,
    ec_3SampleEntry: () => ec_3SampleEntry,
    edtsBox: () => edtsBox,
    elngBox: () => elngBox,
    elstBox: () => elstBox,
    emsgBox: () => emsgBox,
    encaSampleEntry: () => encaSampleEntry,
    encmSampleEntry: () => encmSampleEntry,
    encsSampleEntry: () => encsSampleEntry,
    enctSampleEntry: () => enctSampleEntry,
    encuSampleEntry: () => encuSampleEntry,
    encvSampleEntry: () => encvSampleEntry,
    enofBox: () => enofBox,
    eqivBox: () => eqivBox,
    esdsBox: () => esdsBox,
    etypBox: () => etypBox,
    fLaCSampleEntry: () => fLaCSampleEntry,
    favcBox: () => favcBox,
    fielBox: () => fielBox,
    fobrBox: () => fobrBox,
    freeBox: () => freeBox,
    frmaBox: () => frmaBox,
    ftypBox: () => ftypBox,
    grplBox: () => grplBox,
    hdlrBox: () => hdlrBox,
    hev1SampleEntry: () => hev1SampleEntry,
    hev2SampleEntry: () => hev2SampleEntry,
    hinfBox: () => hinfBox,
    hmhdBox: () => hmhdBox,
    hntiBox: () => hntiBox,
    hvc1SampleEntry: () => hvc1SampleEntry,
    hvc2SampleEntry: () => hvc2SampleEntry,
    hvcCBox: () => hvcCBox,
    hvt1SampleEntry: () => hvt1SampleEntry,
    iaugBox: () => iaugBox,
    idatBox: () => idatBox,
    iinfBox: () => iinfBox,
    ilocBox: () => ilocBox,
    ilstBox: () => ilstBox,
    imirBox: () => imirBox,
    infeBox: () => infeBox,
    iodsBox: () => iodsBox,
    ipcoBox: () => ipcoBox,
    ipmaBox: () => ipmaBox,
    iproBox: () => iproBox,
    iprpBox: () => iprpBox,
    irefBox: () => irefBox,
    irotBox: () => irotBox,
    ispeBox: () => ispeBox,
    itaiBox: () => itaiBox,
    j2kHBox: () => j2kHBox,
    j2kiSampleEntry: () => j2kiSampleEntry,
    keysBox: () => keysBox,
    kindBox: () => kindBox,
    levaBox: () => levaBox,
    lhe1SampleEntry: () => lhe1SampleEntry,
    lhv1SampleEntry: () => lhv1SampleEntry,
    lhvCBox: () => lhvCBox,
    lselBox: () => lselBox,
    lvc1SampleEntry: () => lvc1SampleEntry,
    lvcCBox: () => lvcCBox,
    m4aeSampleEntry: () => m4aeSampleEntry,
    maxrBox: () => maxrBox,
    mdatBox: () => mdatBox,
    mdcvBox: () => mdcvBox,
    mdhdBox: () => mdhdBox,
    mdiaBox: () => mdiaBox,
    mecoBox: () => mecoBox,
    mehdBox: () => mehdBox,
    metaBox: () => metaBox,
    mettSampleEntry: () => mettSampleEntry,
    metxSampleEntry: () => metxSampleEntry,
    mfhdBox: () => mfhdBox,
    mfraBox: () => mfraBox,
    mfroBox: () => mfroBox,
    mha1SampleEntry: () => mha1SampleEntry,
    mha2SampleEntry: () => mha2SampleEntry,
    mhm1SampleEntry: () => mhm1SampleEntry,
    mhm2SampleEntry: () => mhm2SampleEntry,
    minfBox: () => minfBox,
    mjp2SampleEntry: () => mjp2SampleEntry,
    mjpgSampleEntry: () => mjpgSampleEntry,
    moofBox: () => moofBox,
    moovBox: () => moovBox,
    mp4aSampleEntry: () => mp4aSampleEntry,
    mp4sSampleEntry: () => mp4sSampleEntry,
    mp4vSampleEntry: () => mp4vSampleEntry,
    mskCBox: () => mskCBox,
    msrcTrackGroupTypeBox: () => msrcTrackGroupTypeBox,
    mvexBox: () => mvexBox,
    mvhdBox: () => mvhdBox,
    mvifSampleGroupEntry: () => mvifSampleGroupEntry,
    nmhdBox: () => nmhdBox,
    npckBox: () => npckBox,
    numpBox: () => numpBox,
    padbBox: () => padbBox,
    panoBox: () => panoBox,
    paspBox: () => paspBox,
    paylBox: () => paylBox,
    paytBox: () => paytBox,
    pdinBox: () => pdinBox,
    piffLsmBox: () => piffLsmBox,
    piffPsshBox: () => piffPsshBox,
    piffSencBox: () => piffSencBox,
    piffTencBox: () => piffTencBox,
    piffTfrfBox: () => piffTfrfBox,
    piffTfxdBox: () => piffTfxdBox,
    pitmBox: () => pitmBox,
    pixiBox: () => pixiBox,
    pmaxBox: () => pmaxBox,
    povdBox: () => povdBox,
    prdiBox: () => prdiBox,
    prfrBox: () => prfrBox,
    prftBox: () => prftBox,
    prgrBox: () => prgrBox,
    profBox: () => profBox,
    prolSampleGroupEntry: () => prolSampleGroupEntry,
    psshBox: () => psshBox,
    pymdBox: () => pymdBox,
    rapSampleGroupEntry: () => rapSampleGroupEntry,
    rashSampleGroupEntry: () => rashSampleGroupEntry,
    resvSampleEntry: () => resvSampleEntry,
    rinfBox: () => rinfBox,
    rollSampleGroupEntry: () => rollSampleGroupEntry,
    rtp_Box: () => rtp_Box,
    saioBox: () => saioBox,
    saizBox: () => saizBox,
    sbgpBox: () => sbgpBox,
    sbpmBox: () => sbpmBox,
    sbttSampleEntry: () => sbttSampleEntry,
    schiBox: () => schiBox,
    schmBox: () => schmBox,
    scifSampleGroupEntry: () => scifSampleGroupEntry,
    scnmSampleGroupEntry: () => scnmSampleGroupEntry,
    sdp_Box: () => sdp_Box,
    sdtpBox: () => sdtpBox,
    seigSampleGroupEntry: () => seigSampleGroupEntry,
    sencBox: () => sencBox,
    sgpdBox: () => sgpdBox,
    sidxBox: () => sidxBox,
    sinfBox: () => sinfBox,
    skipBox: () => skipBox,
    slidBox: () => slidBox,
    smhdBox: () => smhdBox,
    sratBox: () => sratBox,
    ssixBox: () => ssixBox,
    stblBox: () => stblBox,
    stcoBox: () => stcoBox,
    stdpBox: () => stdpBox,
    sterBox: () => sterBox,
    sthdBox: () => sthdBox,
    stppSampleEntry: () => stppSampleEntry,
    strdBox: () => strdBox,
    striBox: () => striBox,
    strkBox: () => strkBox,
    stsaSampleGroupEntry: () => stsaSampleGroupEntry,
    stscBox: () => stscBox,
    stsdBox: () => stsdBox,
    stsgBox: () => stsgBox,
    stshBox: () => stshBox,
    stssBox: () => stssBox,
    stszBox: () => stszBox,
    sttsBox: () => sttsBox,
    stviBox: () => stviBox,
    stxtSampleEntry: () => stxtSampleEntry,
    stypBox: () => stypBox,
    stz2Box: () => stz2Box,
    subsBox: () => subsBox,
    syncSampleGroupEntry: () => syncSampleGroupEntry,
    taicBox: () => taicBox,
    taptBox: () => taptBox,
    teleSampleGroupEntry: () => teleSampleGroupEntry,
    tencBox: () => tencBox,
    tfdtBox: () => tfdtBox,
    tfhdBox: () => tfhdBox,
    tfraBox: () => tfraBox,
    tkhdBox: () => tkhdBox,
    tmaxBox: () => tmaxBox,
    tminBox: () => tminBox,
    totlBox: () => totlBox,
    tpayBox: () => tpayBox,
    tpylBox: () => tpylBox,
    trafBox: () => trafBox,
    trakBox: () => trakBox,
    trefBox: () => trefBox,
    trepBox: () => trepBox,
    trexBox: () => trexBox,
    trgrBox: () => trgrBox,
    trpyBox: () => trpyBox,
    trunBox: () => trunBox,
    tsasSampleGroupEntry: () => tsasSampleGroupEntry,
    tsclSampleGroupEntry: () => tsclSampleGroupEntry,
    tselBox: () => tselBox,
    tsynBox: () => tsynBox,
    tx3gSampleEntry: () => tx3gSampleEntry,
    txtcBox: () => txtcBox,
    tycoBox: () => tycoBox,
    udesBox: () => udesBox,
    udtaBox: () => udtaBox,
    uncCBox: () => uncCBox,
    uncvSampleEntry: () => uncvSampleEntry,
    urlBox: () => urlBox,
    urnBox: () => urnBox,
    viprSampleGroupEntry: () => viprSampleGroupEntry,
    vmhdBox: () => vmhdBox,
    vp08SampleEntry: () => vp08SampleEntry,
    vp09SampleEntry: () => vp09SampleEntry,
    vpcCBox: () => vpcCBox,
    vttCBox: () => vttCBox,
    vttcBox: () => vttcBox,
    vvc1SampleEntry: () => vvc1SampleEntry,
    vvcCBox: () => vvcCBox,
    vvcNSampleEntry: () => vvcNSampleEntry,
    vvi1SampleEntry: () => vvi1SampleEntry,
    vvnCBox: () => vvnCBox,
    vvs1SampleEntry: () => vvs1SampleEntry,
    waveBox: () => waveBox,
    wbbrBox: () => wbbrBox,
    wvttSampleEntry: () => wvttSampleEntry,
    xmlBox: () => xmlBox
  });
  var BoxParser = registerBoxes(all_boxes_exports);
  registerDescriptors(descriptor_exports);

  // packages/core/dist/index.js
  var HEVCDecoder = class _HEVCDecoder {
    constructor(module) {
      this._m = module;
      this._api = {
        create: module.cwrap("hevc_decoder_create", "number", []),
        destroy: module.cwrap("hevc_decoder_destroy", null, ["number"]),
        decode: module.cwrap("hevc_decoder_decode", "number", ["number", "number", "number"]),
        getFrameCount: module.cwrap("hevc_decoder_get_frame_count", "number", ["number"]),
        getFrame: module.cwrap("hevc_decoder_get_frame", "number", ["number", "number", "number"]),
        getInfo: module.cwrap("hevc_decoder_get_info", "number", ["number", "number"]),
        feed: module.cwrap("hevc_decoder_feed", "number", ["number", "number", "number"]),
        drain: module.cwrap("hevc_decoder_drain", "number", ["number", "number"]),
        getDrainedFrame: module.cwrap("hevc_decoder_get_drained_frame", "number", ["number", "number", "number"]),
        flush: module.cwrap("hevc_decoder_flush", "number", ["number"])
      };
      this._dec = this._api.create();
      if (!this._dec) throw new Error("Failed to create HEVC decoder");
    }
    /**
     * Create a new decoder instance. Loads the WASM module.
     */
    static async create(options) {
      const factoryOpts = {};
      if (options?.wasmBinaryUrl) {
        factoryOpts.locateFile = () => options.wasmBinaryUrl;
      }
      const g = globalThis;
      if (typeof g.HEVCDecoderModule === "function") {
        const module2 = await g.HEVCDecoderModule(factoryOpts);
        return new _HEVCDecoder(module2);
      }
      const wasmUrl = options?.wasmUrl ?? "./wasm/hevc-decode.js";
      const mod = await import(
        /* @vite-ignore */
        wasmUrl
      );
      const fn = mod.default ?? mod;
      const module = await fn(factoryOpts);
      return new _HEVCDecoder(module);
    }
    /**
     * Decode a complete HEVC bitstream.
     * @param data Raw .265 bitstream bytes
     */
    decode(data) {
      const m = this._m;
      const ptr = m._malloc(data.length);
      try {
        m.HEAPU8.set(data, ptr);
        const ret = this._api.decode(this._dec, ptr, data.length);
        if (ret !== 0) throw new Error(`Decode failed (code ${ret})`);
        const count = this._api.getFrameCount(this._dec);
        const frames = [];
        for (let i = 0; i < count; i++) {
          const frame = this._extractFrame(i);
          if (frame) frames.push(frame);
        }
        const info = this._extractInfo();
        return { frames, info };
      } finally {
        m._free(ptr);
      }
    }
    /** Number of decoded frames available */
    get frameCount() {
      return this._api.getFrameCount(this._dec);
    }
    /** Get stream info (available after decode) */
    get info() {
      return this._extractInfo();
    }
    _extractFrame(index) {
      const m = this._m;
      const framePtr = m._malloc(48);
      try {
        const ret = this._api.getFrame(this._dec, index, framePtr);
        if (ret !== 0) return null;
        return this._readFrameFromPtr(framePtr);
      } finally {
        m._free(framePtr);
      }
    }
    _extractDrainedFrame(index) {
      const m = this._m;
      const framePtr = m._malloc(48);
      try {
        const ret = this._api.getDrainedFrame(this._dec, index, framePtr);
        if (ret !== 0) return null;
        return this._readFrameFromPtr(framePtr);
      } finally {
        m._free(framePtr);
      }
    }
    _readFrameFromPtr(framePtr) {
      const m = this._m;
      const yPtr = m.getValue(framePtr, "*");
      const cbPtr = m.getValue(framePtr + 4, "*");
      const crPtr = m.getValue(framePtr + 8, "*");
      const width = m.getValue(framePtr + 12, "i32");
      const height = m.getValue(framePtr + 16, "i32");
      const strideY = m.getValue(framePtr + 20, "i32");
      const strideC = m.getValue(framePtr + 24, "i32");
      const cw = m.getValue(framePtr + 28, "i32");
      const ch = m.getValue(framePtr + 32, "i32");
      const bd = m.getValue(framePtr + 36, "i32");
      const poc = m.getValue(framePtr + 40, "i32");
      const y = copyPlane(m, yPtr, width, height, strideY);
      const cb = copyPlane(m, cbPtr, cw, ch, strideC);
      const cr = copyPlane(m, crPtr, cw, ch, strideC);
      return { y, cb, cr, width, height, chromaWidth: cw, chromaHeight: ch, bitDepth: bd, poc };
    }
    _extractInfo() {
      const m = this._m;
      const infoPtr = m._malloc(24);
      try {
        const ret = this._api.getInfo(this._dec, infoPtr);
        if (ret !== 0) return null;
        return {
          width: m.getValue(infoPtr, "i32"),
          height: m.getValue(infoPtr + 4, "i32"),
          bitDepth: m.getValue(infoPtr + 8, "i32"),
          chromaFormat: m.getValue(infoPtr + 12, "i32"),
          profile: m.getValue(infoPtr + 16, "i32"),
          level: m.getValue(infoPtr + 20, "i32")
        };
      } finally {
        m._free(infoPtr);
      }
    }
    // --- Incremental API (streaming) ---
    /**
     * Feed a chunk of data containing one or more complete NAL units.
     * The decoder accumulates parameter sets and decodes pictures incrementally.
     * Call drain() after each feed() to retrieve output-ready frames.
     */
    feed(data) {
      const m = this._m;
      const ptr = m._malloc(data.length);
      try {
        m.HEAPU8.set(data, ptr);
        const ret = this._api.feed(this._dec, ptr, data.length);
        if (ret !== 0) throw new Error(`Feed failed (code ${ret})`);
      } finally {
        m._free(ptr);
      }
    }
    /**
     * Drain output-ready frames from the decoder (§C.5.2 bumping process).
     * Returns frames in display order, only when ready per DPB constraints.
     * Frames are valid until the next feed() or destroy() call.
     */
    drain() {
      const m = this._m;
      const countPtr = m._malloc(4);
      try {
        const ret = this._api.drain(this._dec, countPtr);
        if (ret !== 0) return [];
        const count = m.getValue(countPtr, "i32");
        const frames = [];
        for (let i = 0; i < count; i++) {
          const frame = this._extractDrainedFrame(i);
          if (frame) frames.push(frame);
        }
        return frames;
      } finally {
        m._free(countPtr);
      }
    }
    /**
     * Flush all remaining frames from the DPB (call at end of stream).
     * Returns all buffered frames in display order.
     */
    flush() {
      const ret = this._api.flush(this._dec);
      if (ret !== 0) return [];
      const m = this._m;
      const countPtr = m._malloc(4);
      try {
        const frames = [];
        const framePtr = m._malloc(48);
        try {
          for (let i = 0; ; i++) {
            const r = this._api.getDrainedFrame(this._dec, i, framePtr);
            if (r !== 0) break;
            frames.push(this._readFrameFromPtr(framePtr));
          }
        } finally {
          m._free(framePtr);
        }
        return frames;
      } finally {
        m._free(countPtr);
      }
    }
    /** Release decoder resources */
    destroy() {
      if (this._dec) {
        this._api.destroy(this._dec);
        this._dec = 0;
      }
    }
  };
  function copyPlane(m, ptr, width, height, stride) {
    const out = new Uint16Array(width * height);
    const base = ptr >> 1;
    for (let y = 0; y < height; y++) {
      out.set(m.HEAPU16.subarray(base + y * stride, base + y * stride + width), y * width);
    }
    return out;
  }
  function pickH264Codec(w, h) {
    const pixels = w * h;
    if (pixels > 2073600) return "avc1.640033";
    if (pixels > 921600) return "avc1.64002a";
    return "avc1.640028";
  }
  var H264Encoder = class {
    constructor(config) {
      this._codecDescription = null;
      this.onChunk = null;
      this.onCodecDescription = null;
      this._width = config.width;
      this._height = config.height;
      this._fps = config.fps ?? 25;
      this._encoder = new VideoEncoder({
        output: (chunk, metadata) => this._handleOutput(chunk, metadata),
        error: (e) => {
          throw new Error(`VideoEncoder error: ${e.message}`);
        }
      });
      this._encoder.configure({
        codec: pickH264Codec(this._width, this._height),
        width: this._width,
        height: this._height,
        bitrate: config.bitrate ?? this._width * this._height * this._fps * 0.1,
        // ~0.1 bpp
        framerate: this._fps,
        hardwareAcceleration: "no-preference",
        latencyMode: "realtime",
        avc: { format: "avc" }
      });
    }
    /** Get the H.264 codec string used by this encoder */
    get codec() {
      return pickH264Codec(this._width, this._height);
    }
    /** Get the avcC codec description (available after first keyframe) */
    get codecDescription() {
      return this._codecDescription;
    }
    /**
     * Encode a decoded HEVC frame.
     * Converts Uint16Array YUV planes to I420 Uint8Array, creates VideoFrame, encodes.
     */
    encode(frame, timestampUs, keyFrame = false) {
      const w = frame.width;
      const h = frame.height;
      const cw = frame.chromaWidth;
      const ch = frame.chromaHeight;
      const shift = frame.bitDepth > 8 ? frame.bitDepth - 8 : 0;
      const ySize = w * h;
      const cSize = cw * ch;
      const i420 = new Uint8Array(ySize + cSize * 2);
      for (let i = 0; i < ySize; i++) {
        const v = frame.y[i] >> shift;
        i420[i] = v > 255 ? 255 : v;
      }
      for (let i = 0; i < cSize; i++) {
        const v = frame.cb[i] >> shift;
        i420[ySize + i] = v > 255 ? 255 : v;
      }
      for (let i = 0; i < cSize; i++) {
        const v = frame.cr[i] >> shift;
        i420[ySize + cSize + i] = v > 255 ? 255 : v;
      }
      const videoFrame = new VideoFrame(i420, {
        format: "I420",
        codedWidth: w,
        codedHeight: h,
        timestamp: timestampUs,
        duration: Math.round(1e6 / this._fps),
        colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709" }
      });
      this._encoder.encode(videoFrame, { keyFrame });
      videoFrame.close();
    }
    /** Flush the encoder — waits for all pending chunks to be output */
    async flush() {
      await this._encoder.flush();
    }
    /** Close the encoder and release resources */
    close() {
      this._encoder.close();
    }
    /** Check if VideoEncoder is supported in the current environment */
    static isSupported() {
      return typeof VideoEncoder !== "undefined";
    }
    /**
     * Async capability probe — checks that VideoEncoder can actually encode H.264.
     * Firefox exposes VideoEncoder but may not support H.264 encoding.
     * Returns false if the API is missing or the config is not supported.
     */
    static async checkSupport() {
      if (typeof VideoEncoder === "undefined") return false;
      if (typeof VideoEncoder.isConfigSupported !== "function") return false;
      try {
        const result = await VideoEncoder.isConfigSupported({
          codec: "avc1.640028",
          width: 640,
          height: 480,
          bitrate: 1e6,
          framerate: 25,
          hardwareAcceleration: "prefer-software"
        });
        return result.supported === true;
      } catch {
        return false;
      }
    }
    _handleOutput(chunk, metadata) {
      if (metadata?.decoderConfig?.description && !this._codecDescription) {
        const desc = metadata.decoderConfig.description;
        if (desc instanceof ArrayBuffer) {
          this._codecDescription = new Uint8Array(desc);
        } else if (desc instanceof Uint8Array) {
          this._codecDescription = new Uint8Array(desc);
        } else if (ArrayBuffer.isView(desc)) {
          this._codecDescription = new Uint8Array(desc.buffer);
        }
        this.onCodecDescription?.(this._codecDescription);
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const encoded = {
        data,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? Math.round(1e6 / this._fps),
        isKeyframe: chunk.type === "key"
      };
      this.onChunk?.(encoded);
    }
  };
  var LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4
  };
  var currentLevel = "info";
  function setLogLevel(level) {
    currentLevel = level;
  }
  var log = {
    debug: (...args) => {
      if (LEVELS[currentLevel] <= LEVELS.debug) console.log("[hevc.js]", ...args);
    },
    info: (...args) => {
      if (LEVELS[currentLevel] <= LEVELS.info) console.log("[hevc.js]", ...args);
    },
    warn: (...args) => {
      if (LEVELS[currentLevel] <= LEVELS.warn) console.warn("[hevc.js]", ...args);
    },
    error: (...args) => {
      if (LEVELS[currentLevel] <= LEVELS.error) console.error("[hevc.js]", ...args);
    }
  };
  var FMP4Demuxer = class {
    constructor() {
      this._mp4box = createFile();
      this._videoTrack = null;
      this._audioTrack = null;
      this._pendingSamples = [];
      this._pendingAudio = [];
      this._offset = 0;
      this._ready = false;
      this._readyPromise = new Promise((resolve) => {
        this._readyResolve = resolve;
      });
      this._mp4box.onReady = (info) => {
        this._onReady(info);
      };
      this._mp4box.onSamples = (trackId, _user, samples) => {
        if (this._audioTrack && trackId === this._audioTrack.trackId) {
          for (const sample of samples) {
            const buf = sample.data;
            this._pendingAudio.push({
              data: ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) : new Uint8Array(buf),
              pts: sample.cts,
              dts: sample.dts,
              duration: sample.duration
            });
          }
          return;
        }
        for (const sample of samples) {
          const nalUnits = extractNalUnitsFromSample(sample.data, this._videoTrack?.nalLengthSize ?? 4);
          this._pendingSamples.push({
            trackId: sample.track_id,
            nalUnits,
            pts: sample.cts,
            dts: sample.dts,
            duration: sample.duration,
            isKeyframe: sample.is_rap || sample.is_sync
          });
        }
      };
      this._mp4box.onError = (e) => {
        log.error("[FMP4Demuxer] mp4box error:", e);
      };
    }
    /** Get the video track info (available after parse) */
    get videoTrack() {
      return this._videoTrack;
    }
    /** Get the audio track info, if the segment carries a muxed audio track. */
    get audioTrack() {
      return this._audioTrack;
    }
    /** Drain all pending audio samples extracted so far (raw AAC frames). */
    drainAudioSamples() {
      const samples = this._pendingAudio;
      this._pendingAudio = [];
      return samples;
    }
    /** Whether the init segment has been parsed */
    get isReady() {
      return this._ready;
    }
    /**
     * Feed data to the demuxer. Works for both init and media segments.
     * Call with the init segment first, then media segments.
     */
    feed(data) {
      const buf = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      );
      buf.fileStart = this._offset;
      this._offset += data.byteLength;
      this._mp4box.appendBuffer(buf);
    }
    /**
     * Wait for the init segment to be parsed (moov box found).
     */
    async waitReady() {
      return this._readyPromise;
    }
    /**
     * Drain all pending samples extracted so far.
     */
    drainSamples() {
      const samples = this._pendingSamples;
      this._pendingSamples = [];
      return samples;
    }
    /**
     * Convenience: parse init segment and wait for ready.
     */
    async parseInit(data) {
      this.feed(data);
      await this.waitReady();
    }
    /**
     * Convenience: feed a media segment and return extracted samples.
     */
    parseSegment(data) {
      this.feed(data);
      return this.drainSamples();
    }
    /** Flush any remaining data in the parser */
    flush() {
      this._mp4box.flush();
    }
    _onReady(info) {
      const videoTrack = info.videoTracks[0] ?? info.tracks.find(
        (t) => t.type === "video"
      );
      if (videoTrack) {
        const isHevc = /^(hev1|hvc1)/i.test(videoTrack.codec);
        this._videoTrack = {
          trackId: videoTrack.id,
          codec: videoTrack.codec,
          timescale: videoTrack.timescale,
          width: videoTrack.width ?? videoTrack.video?.width ?? 0,
          height: videoTrack.height ?? videoTrack.video?.height ?? 0,
          nalLengthSize: isHevc ? 4 : 4
          // mp4box.js handles both
        };
        this._mp4box.setExtractionOptions(videoTrack.id, void 0, { nbSamples: 100 });
      }
      const audioTrack = info.audioTracks?.[0] ?? info.tracks.find(
        (t) => t.type === "audio"
      );
      if (audioTrack) {
        const asc = extractAudioSpecificConfig(this._mp4box, audioTrack.id);
        this._audioTrack = {
          trackId: audioTrack.id,
          codec: audioTrack.codec,
          timescale: audioTrack.timescale,
          channelCount: audioTrack.audio?.channel_count ?? 2,
          sampleRate: audioTrack.audio?.sample_rate ?? 48e3,
          sampleSize: audioTrack.audio?.sample_size ?? 16,
          asc: asc ?? new Uint8Array(0)
        };
        this._mp4box.setExtractionOptions(audioTrack.id, void 0, { nbSamples: 100 });
      }
      this._ready = true;
      this._readyResolve();
      this._mp4box.start();
    }
  };
  function extractAudioSpecificConfig(mp4box, trackId) {
    try {
      const moov = mp4box.moov;
      const trak = moov?.traks?.find((t) => t.tkhd?.track_id === trackId);
      const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
      const descs = entry?.esds?.esd?.descs ?? [];
      const decoderConfig = descs.find((d) => d.tag === 4);
      const dsi = decoderConfig?.descs?.find((d) => d.tag === 5);
      if (dsi?.data) return dsi.data instanceof Uint8Array ? dsi.data.slice() : new Uint8Array(dsi.data);
    } catch {
    }
    return null;
  }
  function extractNalUnitsFromSample(data, nalLengthSize) {
    const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const nalUnits = [];
    let offset = 0;
    while (offset + nalLengthSize <= buf.byteLength) {
      let nalLength;
      switch (nalLengthSize) {
        case 1:
          nalLength = view.getUint8(offset);
          break;
        case 2:
          nalLength = view.getUint16(offset);
          break;
        case 4:
          nalLength = view.getUint32(offset);
          break;
        default:
          nalLength = view.getUint32(offset);
          break;
      }
      offset += nalLengthSize;
      if (offset + nalLength > buf.byteLength) break;
      nalUnits.push(bytes.slice(offset, offset + nalLength));
      offset += nalLength;
    }
    return nalUnits;
  }
  var FMP4Muxer = class {
    constructor() {
      this._sequenceNumber = 1;
    }
    /**
     * Generate an init segment (ftyp + moov) for H.264 fMP4.
     */
    generateInit(config) {
      const ftyp = boxFtyp();
      const moov = boxMoov(config);
      return concat(ftyp, moov);
    }
    /**
     * Generate a media segment (moof + mdat) from encoded samples.
     */
    muxSegment(samples, baseDecodeTime) {
      const mdat = boxMdat(samples);
      const moof = boxMoof(this._sequenceNumber++, samples, baseDecodeTime);
      return concat(moof, mdat);
    }
    /**
     * Generate a two-track (video + audio) init segment. Video track_ID=1,
     * audio track_ID=2. Used for muxed A/V streams: the H.264 video is
     * transcoded, the AAC audio is passed through, and both are re-muxed into
     * one `audiovideo` output so a single SourceBuffer plays both.
     */
    generateInitAV(video, audio) {
      return concat(boxFtyp(), boxMoovAV(video, audio));
    }
    /**
     * Generate a two-track media segment: one moof with a video traf and an
     * audio traf, followed by a single mdat holding the video samples then the
     * audio samples. Base decode times are per-track (different timescales).
     */
    muxSegmentAV(videoSamples, videoBaseTime, audioSamples, audioBaseTime) {
      const videoBytes = videoSamples.reduce((s, x) => s + x.data.byteLength, 0);
      const mdat = boxMdatAV(videoSamples, audioSamples);
      const moof = boxMoofAV(
        this._sequenceNumber++,
        videoSamples,
        videoBaseTime,
        audioSamples,
        audioBaseTime,
        videoBytes
      );
      return concat(moof, mdat);
    }
  };
  function u32be(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value);
    return b;
  }
  function fourcc(s) {
    return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
  }
  function concat(...arrays) {
    const total = arrays.reduce((sum, a) => sum + a.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      out.set(a, offset);
      offset += a.byteLength;
    }
    return out;
  }
  function box(type, ...payloads) {
    const payload = concat(...payloads);
    const size = 8 + payload.byteLength;
    return concat(u32be(size), fourcc(type), payload);
  }
  function fullBox(type, version, flags, ...payloads) {
    const vf = new Uint8Array(4);
    new DataView(vf.buffer).setUint32(0, version << 24 | flags & 16777215);
    return box(type, vf, ...payloads);
  }
  function boxFtyp() {
    return box(
      "ftyp",
      fourcc("isom"),
      // major brand
      u32be(512),
      // minor version
      fourcc("isom"),
      // compatible brands
      fourcc("iso2"),
      fourcc("avc1"),
      fourcc("mp41")
    );
  }
  function boxMoov(config) {
    const mvhd = boxMvhd(config.timescale);
    const trak = boxTrak(config);
    const mvex = box("mvex", boxTrex());
    return box("moov", mvhd, trak, mvex);
  }
  function boxMvhd(timescale, nextTrackId = 2) {
    const data = new Uint8Array(96);
    const v = new DataView(data.buffer);
    v.setUint32(8, timescale);
    v.setUint32(16, 65536);
    v.setUint16(20, 256);
    const matrix = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
    for (let i = 0; i < 9; i++) v.setUint32(32 + i * 4, matrix[i]);
    v.setUint32(92, nextTrackId);
    return fullBox("mvhd", 0, 0, data);
  }
  function boxTfdt(baseDecodeTime) {
    if (baseDecodeTime <= 4294967295) {
      return fullBox("tfdt", 0, 0, u32be(baseDecodeTime));
    }
    const d = new Uint8Array(8);
    const dv = new DataView(d.buffer);
    dv.setUint32(0, Math.floor(baseDecodeTime / 4294967296));
    dv.setUint32(4, baseDecodeTime & 4294967295);
    return fullBox("tfdt", 1, 0, d);
  }
  function boxTrak(config) {
    const tkhd = boxTkhd(config.width, config.height);
    const mdia = boxMdia(config);
    return box("trak", tkhd, mdia);
  }
  function boxTkhd(width, height) {
    const data = new Uint8Array(80);
    const v = new DataView(data.buffer);
    v.setUint32(8, 1);
    const matrix = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
    for (let i = 0; i < 9; i++) v.setUint32(36 + i * 4, matrix[i]);
    v.setUint32(72, width << 16);
    v.setUint32(76, height << 16);
    return fullBox("tkhd", 0, 3, data);
  }
  function boxMdia(config) {
    const mdhd = boxMdhd(config.timescale);
    const hdlr = boxHdlr();
    const minf = boxMinf(config);
    return box("mdia", mdhd, hdlr, minf);
  }
  function boxMdhd(timescale) {
    const data = new Uint8Array(20);
    const v = new DataView(data.buffer);
    v.setUint32(8, timescale);
    v.setUint16(16, 21956);
    return fullBox("mdhd", 0, 0, data);
  }
  function boxHdlr() {
    const data = new Uint8Array(21);
    const v = new DataView(data.buffer);
    v.setUint32(4, 1986618469);
    data[20] = 0;
    return fullBox("hdlr", 0, 0, data);
  }
  function boxMinf(config) {
    const vmhd = fullBox("vmhd", 0, 1, new Uint8Array(8));
    const dinf = box("dinf", fullBox("dref", 0, 0, u32be(1), fullBox("url ", 0, 1)));
    const stbl = boxStbl(config);
    return box("minf", vmhd, dinf, stbl);
  }
  function boxStbl(config) {
    const stsd = boxStsd(config);
    const stts = fullBox("stts", 0, 0, u32be(0));
    const stsc = fullBox("stsc", 0, 0, u32be(0));
    const stsz = fullBox("stsz", 0, 0, u32be(0), u32be(0));
    const stco = fullBox("stco", 0, 0, u32be(0));
    return box("stbl", stsd, stts, stsc, stsz, stco);
  }
  function boxStsd(config) {
    const avc1 = boxAvc1(config);
    return fullBox("stsd", 0, 0, u32be(1), avc1);
  }
  function boxAvc1(config) {
    const header = new Uint8Array(78);
    const v = new DataView(header.buffer);
    v.setUint16(6, 1);
    v.setUint16(24, config.width);
    v.setUint16(26, config.height);
    v.setUint32(28, 4718592);
    v.setUint32(32, 4718592);
    v.setUint16(40, 1);
    v.setUint16(74, 24);
    v.setInt16(76, -1);
    const avcC = box("avcC", config.avcC);
    return box("avc1", header, avcC);
  }
  function boxTrex() {
    const data = new Uint8Array(20);
    const v = new DataView(data.buffer);
    v.setUint32(0, 1);
    v.setUint32(4, 1);
    return fullBox("trex", 0, 0, data);
  }
  function boxMoof(sequenceNumber, samples, baseDecodeTime) {
    const mfhd = fullBox("mfhd", 0, 0, u32be(sequenceNumber));
    const moof = box("moof", mfhd, boxTraf(samples, baseDecodeTime));
    patchTrunDataOffsets(moof, [moof.byteLength + 8]);
    return moof;
  }
  function boxTraf(samples, baseDecodeTime) {
    const tfhd = fullBox("tfhd", 0, 131072, u32be(1));
    return box("traf", tfhd, boxTfdt(baseDecodeTime), boxTrun(samples));
  }
  function boxTrun(samples) {
    const flags = 1 | 256 | 512 | 1024 | 2048;
    const headerSize = 8;
    const perSample = 16;
    const data = new Uint8Array(headerSize + samples.length * perSample);
    const v = new DataView(data.buffer);
    v.setUint32(0, samples.length);
    v.setUint32(4, 0);
    let offset = headerSize;
    for (const sample of samples) {
      v.setUint32(offset, sample.duration);
      v.setUint32(offset + 4, sample.data.byteLength);
      const sampleFlags = sample.isKeyframe ? 33554432 : 16842752;
      v.setUint32(offset + 8, sampleFlags);
      v.setInt32(offset + 12, sample.compositionTimeOffset ?? 0);
      offset += perSample;
    }
    return fullBox("trun", 0, flags, data);
  }
  function boxMdat(samples) {
    const totalSize = samples.reduce((sum, s) => sum + s.data.byteLength, 0);
    const payload = new Uint8Array(totalSize);
    let offset = 0;
    for (const sample of samples) {
      payload.set(sample.data, offset);
      offset += sample.data.byteLength;
    }
    return box("mdat", payload);
  }
  function boxMoovAV(video, audio) {
    const mvhd = boxMvhd(video.timescale, 3);
    const videoTrak = boxTrak(video);
    const audioTrak = boxTrakAudio(audio);
    const mvex = box("mvex", boxTrex(), boxTrexAudio());
    return box("moov", mvhd, videoTrak, audioTrak, mvex);
  }
  function boxTrakAudio(audio) {
    const tkhd = boxTkhdAudio();
    const mdia = boxMdiaAudio(audio);
    return box("trak", tkhd, mdia);
  }
  function boxTkhdAudio() {
    const data = new Uint8Array(80);
    const v = new DataView(data.buffer);
    v.setUint32(8, 2);
    v.setUint16(32, 256);
    const matrix = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
    for (let i = 0; i < 9; i++) v.setUint32(36 + i * 4, matrix[i]);
    return fullBox("tkhd", 0, 3, data);
  }
  function boxMdiaAudio(audio) {
    const mdhd = boxMdhd(audio.timescale);
    const hdlr = boxHdlrAudio();
    const minf = boxMinfAudio(audio);
    return box("mdia", mdhd, hdlr, minf);
  }
  function boxHdlrAudio() {
    const data = new Uint8Array(21);
    const v = new DataView(data.buffer);
    v.setUint32(4, 1936684398);
    return fullBox("hdlr", 0, 0, data);
  }
  function boxMinfAudio(audio) {
    const smhd = fullBox("smhd", 0, 0, new Uint8Array(4));
    const dinf = box("dinf", fullBox("dref", 0, 0, u32be(1), fullBox("url ", 0, 1)));
    const stbl = boxStblAudio(audio);
    return box("minf", smhd, dinf, stbl);
  }
  function boxStblAudio(audio) {
    const stsd = fullBox("stsd", 0, 0, u32be(1), boxMp4a(audio));
    const stts = fullBox("stts", 0, 0, u32be(0));
    const stsc = fullBox("stsc", 0, 0, u32be(0));
    const stsz = fullBox("stsz", 0, 0, u32be(0), u32be(0));
    const stco = fullBox("stco", 0, 0, u32be(0));
    return box("stbl", stsd, stts, stsc, stsz, stco);
  }
  function boxMp4a(audio) {
    const header = new Uint8Array(28);
    const v = new DataView(header.buffer);
    v.setUint16(6, 1);
    v.setUint16(16, audio.channelCount);
    v.setUint16(18, audio.sampleSize);
    v.setUint32(24, Math.min(audio.sampleRate, 65535) << 16);
    return box("mp4a", header, boxEsds(audio.asc));
  }
  function boxEsds(asc) {
    const dsi = descriptor(5, asc);
    const dcdHead = new Uint8Array(13);
    dcdHead[0] = 64;
    dcdHead[1] = 5 << 2 | 1;
    const dcd = descriptor(4, dcdHead, dsi);
    const sl = descriptor(6, new Uint8Array([2]));
    const es = descriptor(3, new Uint8Array([0, 0, 0]), dcd, sl);
    return fullBox("esds", 0, 0, es);
  }
  function descriptor(tag, ...payloads) {
    const payload = concat(...payloads);
    const sizeBytes = [];
    let len = payload.byteLength;
    do {
      sizeBytes.unshift(len & 127);
      len >>>= 7;
    } while (len > 0);
    for (let i = 0; i < sizeBytes.length - 1; i++) sizeBytes[i] |= 128;
    return concat(new Uint8Array([tag, ...sizeBytes]), payload);
  }
  function boxTrexAudio() {
    const data = new Uint8Array(20);
    const v = new DataView(data.buffer);
    v.setUint32(0, 2);
    v.setUint32(4, 1);
    return fullBox("trex", 0, 0, data);
  }
  function boxMoofAV(sequenceNumber, videoSamples, videoBaseTime, audioSamples, audioBaseTime, videoBytes) {
    const mfhd = fullBox("mfhd", 0, 0, u32be(sequenceNumber));
    const videoTraf = boxTraf(videoSamples, videoBaseTime);
    const audioTraf = boxTrafAudio(audioSamples, audioBaseTime);
    const moof = box("moof", mfhd, videoTraf, audioTraf);
    const mdatPayloadStart = moof.byteLength + 8;
    patchTrunDataOffsets(moof, [mdatPayloadStart, mdatPayloadStart + videoBytes]);
    return moof;
  }
  function boxTrafAudio(samples, baseDecodeTime) {
    const tfhd = fullBox("tfhd", 0, 131072, u32be(2));
    return box("traf", tfhd, boxTfdt(baseDecodeTime), boxTrunAudio(samples));
  }
  function boxTrunAudio(samples) {
    const flags = 1 | 256 | 512;
    const data = new Uint8Array(8 + samples.length * 8);
    const v = new DataView(data.buffer);
    v.setUint32(0, samples.length);
    v.setUint32(4, 0);
    let offset = 8;
    for (const s of samples) {
      v.setUint32(offset, s.duration);
      v.setUint32(offset + 4, s.data.byteLength);
      offset += 8;
    }
    return fullBox("trun", 0, flags, data);
  }
  function patchTrunDataOffsets(moof, offsets) {
    const view = new DataView(moof.buffer, moof.byteOffset, moof.byteLength);
    let offset = 8;
    let trafIndex = 0;
    while (offset + 8 <= moof.byteLength) {
      const size = view.getUint32(offset);
      const type = view.getUint32(offset + 4);
      if (type === 1953653094) {
        let inner = offset + 8;
        while (inner + 8 <= offset + size) {
          const isize = view.getUint32(inner);
          if (view.getUint32(inner + 4) === 1953658222) {
            view.setUint32(inner + 8 + 4 + 4, offsets[trafIndex]);
            break;
          }
          inner += isize;
        }
        trafIndex++;
      }
      offset += size;
    }
  }
  function boxMdatAV(videoSamples, audioSamples) {
    const videoBytes = videoSamples.reduce((s, x) => s + x.data.byteLength, 0);
    const audioBytes = audioSamples.reduce((s, x) => s + x.data.byteLength, 0);
    const payload = new Uint8Array(videoBytes + audioBytes);
    let offset = 0;
    for (const s of videoSamples) {
      payload.set(s.data, offset);
      offset += s.data.byteLength;
    }
    for (const s of audioSamples) {
      payload.set(s.data, offset);
      offset += s.data.byteLength;
    }
    return box("mdat", payload);
  }
  function hevcMimeToH264Codec(mime) {
    if (typeof mime !== "string") return "avc1.640033";
    const match = mime.match(/\.[LH](\d+)/);
    if (!match) return "avc1.640033";
    const level = parseInt(match[1], 10);
    if (level >= 150) return "avc1.640033";
    if (level >= 120) return "avc1.64002a";
    return "avc1.640028";
  }
  var listeners = /* @__PURE__ */ new Set();
  function publishSegmentStat(stat) {
    for (const l of listeners) {
      try {
        l(stat);
      } catch (err) {
        console.error("[hevc.js/perf-bus] listener threw:", err);
      }
    }
  }
  function subscribeSegmentStat(l) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }
  var SegmentTranscoder = class {
    constructor(config = {}) {
      this._decoder = null;
      this._demuxer = null;
      this._encoder = null;
      this._muxer = new FMP4Muxer();
      this._initialized = false;
      this._initResult = null;
      this._timescale = 9e4;
      this._baseDecodeTime = 0;
      this._fpsAutoDetected = false;
      this._width = 0;
      this._height = 0;
      this._paramSetsFed = false;
      this._paramSetsBuffer = null;
      this._audioConfig = null;
      this.lastPerfStats = null;
      this._config = config;
      this._fps = config.fps ?? 25;
    }
    /** Whether the source carries a muxed audio track we pass through. */
    get hasMuxedAudio() {
      return this._audioConfig !== null;
    }
    /** Whether the transcoder is ready to process segments */
    get isInitialized() {
      return this._initialized;
    }
    /** The H.264 init segment result (available after processInitSegment) */
    get initResult() {
      return this._initResult;
    }
    /** Initialize the WASM decoder */
    async init() {
      const decoderOpts = {};
      if (this._config.wasmUrl) decoderOpts.wasmUrl = this._config.wasmUrl;
      if (this._config.wasmBinaryUrl) decoderOpts.wasmBinaryUrl = this._config.wasmBinaryUrl;
      this._decoder = await HEVCDecoder.create(decoderOpts);
      this._initialized = true;
    }
    /**
     * Process an HEVC init segment (ftyp + moov) — parses track metadata and
     * extracts VPS/SPS/PPS for the WASM decoder. The H.264 init segment is
     * generated lazily on the first media segment, because the H.264 avcC
     * descriptor only exists after the first encoded frame.
     *
     * If you need the H.264 init segment up-front (e.g. when feeding Shaka's
     * `Transmuxer.transmux()` which expects a result for the init segment
     * before any media is delivered), use `prepareInit()` instead.
     */
    async processInitSegment(data) {
      this._demuxer = new FMP4Demuxer();
      await this._demuxer.parseInit(data);
      const track = this._demuxer.videoTrack;
      if (track) {
        this._timescale = track.timescale;
        this._width = track.width;
        this._height = track.height;
      }
      const audio = this._demuxer.audioTrack;
      if (audio) {
        if (audio.asc.byteLength === 0) {
          log.warn(
            "Muxed audio track has no AudioSpecificConfig \u2014 the audio track may fail to decode. The video is still transcoded."
          );
        }
        this._audioConfig = {
          timescale: audio.timescale,
          channelCount: audio.channelCount,
          sampleRate: audio.sampleRate,
          sampleSize: audio.sampleSize,
          asc: audio.asc
        };
      } else {
        this._audioConfig = null;
      }
      const paramSets = extractParameterSetsFromInit(data);
      if (paramSets.length > 0) {
        const psSize = paramSets.reduce((s, n) => s + 4 + n.byteLength, 0);
        this._paramSetsBuffer = new Uint8Array(psSize);
        let off = 0;
        for (const ps of paramSets) {
          this._paramSetsBuffer[off++] = 0;
          this._paramSetsBuffer[off++] = 0;
          this._paramSetsBuffer[off++] = 0;
          this._paramSetsBuffer[off++] = 1;
          this._paramSetsBuffer.set(ps, off);
          off += ps.byteLength;
        }
      }
    }
    /**
     * Process an HEVC init segment AND immediately produce a matching H.264
     * fMP4 init segment by encoding a single black warmup frame to obtain a
     * valid avcC descriptor. Useful for callers that must hand an init
     * segment back to the player before any media segment has been seen
     * (e.g. Shaka's `Transmuxer.transmux()`).
     *
     * After this call, `initResult` is populated and `processMediaSegment()`
     * will skip the lazy init-generation path on its first call.
     */
    async prepareInit(data) {
      if (this._encoder) {
        this._encoder.close();
        this._encoder = null;
      }
      this._paramSetsFed = false;
      this._initResult = null;
      await this.processInitSegment(data);
      if (this._width === 0 || this._height === 0) {
        throw new Error("prepareInit: missing dimensions in HEVC init segment");
      }
      const warmup = new H264Encoder({
        width: this._width,
        height: this._height,
        fps: this._fps,
        bitrate: this._config.bitrate
      });
      const cw = this._width >> 1;
      const ch = this._height >> 1;
      const blackFrame = {
        y: new Uint16Array(this._width * this._height),
        cb: new Uint16Array(cw * ch).fill(128),
        cr: new Uint16Array(cw * ch).fill(128),
        width: this._width,
        height: this._height,
        chromaWidth: cw,
        chromaHeight: ch,
        bitDepth: 8,
        poc: 0
      };
      warmup.onChunk = () => {
      };
      warmup.encode(blackFrame, 0, true);
      await warmup.flush();
      const avcC = warmup.codecDescription;
      const codec = warmup.codec;
      warmup.close();
      if (!avcC) {
        throw new Error("prepareInit: encoder produced no avcC after warmup");
      }
      const initSegment = this._muxer.generateInit({
        width: this._width,
        height: this._height,
        timescale: this._timescale,
        avcC
      });
      this._initResult = { initSegment, codec };
      return this._initResult;
    }
    async processMediaSegment(data) {
      if (!this._decoder || !this._demuxer) {
        throw new Error("Transcoder not initialized. Call init() and processInitSegment() first.");
      }
      const tDemux0 = performance.now();
      const samples = this._demuxer.parseSegment(data);
      if (samples.length === 0) return null;
      const tDemuxEnd = performance.now();
      const segmentBaseTime = rebaseSamplesToTfdt(samples, extractTfdt(data));
      if (!this._fpsAutoDetected && !this._config.fps && samples[0].duration > 0) {
        this._fps = this._timescale / samples[0].duration;
        this._fpsAutoDetected = true;
        log.debug(`Auto-detected fps: ${this._fps.toFixed(2)} (timescale=${this._timescale}, sample_duration=${samples[0].duration})`);
      }
      const sortedPts = samples.map((s) => s.pts).sort((a, b) => a - b);
      if (!this._paramSetsFed && this._paramSetsBuffer) {
        this._decoder.feed(this._paramSetsBuffer);
        this._paramSetsFed = true;
      }
      for (const sample of samples) {
        const totalSize = sample.nalUnits.reduce((sum, n) => sum + 4 + n.length, 0);
        const nalBuffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const nal of sample.nalUnits) {
          nalBuffer[offset++] = 0;
          nalBuffer[offset++] = 0;
          nalBuffer[offset++] = 0;
          nalBuffer[offset++] = 1;
          nalBuffer.set(nal, offset);
          offset += nal.length;
        }
        this._decoder.feed(nalBuffer);
      }
      const frames = this._decoder.drain();
      const tDecodeEnd = performance.now();
      if (frames.length === 0) {
        this.lastPerfStats = null;
        return null;
      }
      const frameW = frames[0].width;
      const frameH = frames[0].height;
      if (this._encoder && (frameW !== this._width || frameH !== this._height)) {
        log.info(`Resolution changed ${this._width}x${this._height} \u2192 ${frameW}x${frameH}, recreating encoder`);
        this._encoder.close();
        this._encoder = null;
        this._initResult = null;
      }
      if (!this._encoder) {
        this._encoder = new H264Encoder({
          width: frameW,
          height: frameH,
          fps: this._fps,
          bitrate: this._config.bitrate
        });
        this._width = frameW;
        this._height = frameH;
      }
      const chunks = [];
      this._encoder.onChunk = (chunk) => chunks.push(chunk);
      for (let i = 0; i < frames.length; i++) {
        const timestampUs = i < sortedPts.length ? Math.round(sortedPts[i] / this._timescale * 1e6) : Math.round(segmentBaseTime / this._timescale * 1e6) + Math.round(i / this._fps * 1e6);
        this._encoder.encode(frames[i], timestampUs, i === 0);
      }
      await this._encoder.flush();
      if (chunks.length === 0) return null;
      if (!this._initResult) {
        const avcC = this._encoder.codecDescription;
        if (!avcC) throw new Error("No avcC description from encoder");
        const videoInit = {
          width: this._width,
          height: this._height,
          timescale: this._timescale,
          avcC
        };
        const initSegment = this._audioConfig ? this._muxer.generateInitAV(videoInit, this._audioConfig) : this._muxer.generateInit(videoInit);
        const codec = this._audioConfig ? `${this._encoder.codec},mp4a.40.2` : this._encoder.codec;
        this._initResult = { initSegment, codec };
      }
      const sortedDurations = [];
      for (let i = 0; i < sortedPts.length - 1; i++) {
        sortedDurations.push(sortedPts[i + 1] - sortedPts[i]);
      }
      if (sortedPts.length > 0) {
        sortedDurations.push(samples[0].duration);
      }
      const muxerSamples = chunks.map((c, i) => ({
        data: c.data,
        duration: i < sortedDurations.length ? sortedDurations[i] : Math.round(c.duration * this._timescale / 1e6),
        isKeyframe: c.isKeyframe,
        compositionTimeOffset: 0
      }));
      const muxBaseTime = sortedPts.length > 0 ? sortedPts[0] : segmentBaseTime;
      let mediaSegment;
      const audioSamples = this._audioConfig ? this._demuxer.drainAudioSamples() : [];
      if (this._audioConfig && audioSamples.length > 0) {
        mediaSegment = this._muxer.muxSegmentAV(
          muxerSamples,
          muxBaseTime,
          audioSamples.map((a) => ({ data: a.data, duration: a.duration })),
          audioSamples[0].dts
        );
      } else {
        mediaSegment = this._muxer.muxSegment(muxerSamples, muxBaseTime);
      }
      const tEncodeEnd = performance.now();
      const demuxMs = tDemuxEnd - tDemux0;
      const decodeMs = tDecodeEnd - tDemuxEnd;
      const encodeMs = tEncodeEnd - tDecodeEnd;
      const segDurTicks = samples.reduce((sum, s) => sum + s.duration, 0);
      const segDurMs = segDurTicks / this._timescale * 1e3;
      this._baseDecodeTime = segmentBaseTime + segDurTicks;
      this.lastPerfStats = {
        demuxMs,
        decodeMs,
        encodeMs,
        frames: frames.length,
        segDurMs,
        width: frameW,
        height: frameH
      };
      const totalMs = demuxMs + decodeMs + encodeMs;
      if (totalMs > 0) {
        publishSegmentStat({
          totalMs,
          segDurMs,
          speedX: segDurMs / totalMs,
          frames: frames.length,
          width: frameW,
          height: frameH
        });
      }
      return mediaSegment;
    }
    /**
     * Streaming variant — identical encode pipeline as processMediaSegment,
     * then splits output chunks into batches for incremental MSE append.
     */
    async processMediaSegmentStreaming(data, onChunk) {
      if (!this._decoder || !this._demuxer) {
        throw new Error("Transcoder not initialized. Call init() and processInitSegment() first.");
      }
      const BATCH_SIZE = 30;
      const tDemux0 = performance.now();
      const samples = this._demuxer.parseSegment(data);
      if (samples.length === 0) return;
      const tDemuxEnd = performance.now();
      const segmentBaseTime = rebaseSamplesToTfdt(samples, extractTfdt(data));
      if (!this._fpsAutoDetected && !this._config.fps && samples[0].duration > 0) {
        this._fps = this._timescale / samples[0].duration;
        this._fpsAutoDetected = true;
      }
      const sortedPts = samples.map((s) => s.pts).sort((a, b) => a - b);
      if (!this._paramSetsFed && this._paramSetsBuffer) {
        this._decoder.feed(this._paramSetsBuffer);
        this._paramSetsFed = true;
      }
      for (const sample of samples) {
        const totalSize = sample.nalUnits.reduce((sum, n) => sum + 4 + n.length, 0);
        const nalBuffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const nal of sample.nalUnits) {
          nalBuffer[offset++] = 0;
          nalBuffer[offset++] = 0;
          nalBuffer[offset++] = 0;
          nalBuffer[offset++] = 1;
          nalBuffer.set(nal, offset);
          offset += nal.length;
        }
        this._decoder.feed(nalBuffer);
      }
      const frames = this._decoder.drain();
      const tDecodeEnd = performance.now();
      if (frames.length === 0) return;
      const frameW = frames[0].width;
      const frameH = frames[0].height;
      if (this._encoder && (frameW !== this._width || frameH !== this._height)) {
        this._encoder.close();
        this._encoder = null;
        this._initResult = null;
      }
      if (!this._encoder) {
        this._encoder = new H264Encoder({
          width: frameW,
          height: frameH,
          fps: this._fps,
          bitrate: this._config.bitrate
        });
        this._width = frameW;
        this._height = frameH;
      }
      let initEmitted = false;
      const tEncode0 = performance.now();
      for (let batchStart = 0; batchStart < frames.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, frames.length);
        const batchChunks = [];
        this._encoder.onChunk = (chunk) => batchChunks.push(chunk);
        for (let i = batchStart; i < batchEnd; i++) {
          const timestampUs = i < sortedPts.length ? Math.round(sortedPts[i] / this._timescale * 1e6) : Math.round(segmentBaseTime / this._timescale * 1e6) + Math.round(i / this._fps * 1e6);
          this._encoder.encode(frames[i], timestampUs, i === 0);
        }
        await this._encoder.flush();
        if (batchChunks.length === 0) continue;
        if (!this._initResult) {
          const avcC = this._encoder.codecDescription;
          if (!avcC) throw new Error("No avcC description from encoder");
          this._initResult = {
            initSegment: this._muxer.generateInit({
              width: this._width,
              height: this._height,
              timescale: this._timescale,
              avcC
            }),
            codec: this._encoder.codec
          };
        }
        const batchBaseTime = batchStart < sortedPts.length ? sortedPts[batchStart] : segmentBaseTime;
        const muxerSamples = batchChunks.map((c, i) => {
          const ptsIdx = batchStart + i;
          const duration = ptsIdx < sortedPts.length - 1 ? sortedPts[ptsIdx + 1] - sortedPts[ptsIdx] : samples[0].duration;
          return {
            data: c.data,
            duration,
            isKeyframe: c.isKeyframe,
            compositionTimeOffset: 0
          };
        });
        const mediaSegment = this._muxer.muxSegment(muxerSamples, batchBaseTime);
        await onChunk(mediaSegment, !initEmitted ? this._initResult : null);
        initEmitted = true;
      }
      const tEncodeEnd = performance.now();
      const demuxMs = tDemuxEnd - tDemux0;
      const decodeMs = tDecodeEnd - tDemuxEnd;
      const encodeMs = tEncodeEnd - tEncode0;
      const segDurTicks = samples.reduce((sum, s) => sum + s.duration, 0);
      const segDurMs = segDurTicks / this._timescale * 1e3;
      this._baseDecodeTime = segmentBaseTime + segDurTicks;
      this.lastPerfStats = {
        demuxMs,
        decodeMs,
        encodeMs,
        frames: frames.length,
        segDurMs,
        width: frameW,
        height: frameH
      };
      const totalMs = demuxMs + decodeMs + encodeMs;
      if (totalMs > 0) {
        publishSegmentStat({
          totalMs,
          segDurMs,
          speedX: segDurMs / totalMs,
          frames: frames.length,
          width: frameW,
          height: frameH
        });
      }
    }
    /**
     * Flush remaining frames from the decoder.
     * Returns the final H.264 media segment, or null if no frames remain.
     */
    async flush() {
      if (!this._decoder) return null;
      const remaining = this._decoder.flush();
      if (remaining.length === 0) return null;
      return this._encodeFrames(remaining);
    }
    /** Release all resources */
    destroy() {
      this._encoder?.close();
      this._decoder?.destroy();
      this._decoder = null;
      this._encoder = null;
      this._demuxer = null;
      this._initResult = null;
    }
    async _encodeFrames(frames) {
      if (!this._encoder || frames.length === 0) return null;
      const chunks = [];
      this._encoder.onChunk = (chunk) => chunks.push(chunk);
      for (let i = 0; i < frames.length; i++) {
        const timestampUs = Math.round(this._baseDecodeTime / this._timescale * 1e6) + Math.round(i / this._fps * 1e6);
        this._encoder.encode(frames[i], timestampUs, i === 0);
      }
      await this._encoder.flush();
      if (chunks.length === 0) return null;
      const muxerSamples = chunks.map((c) => ({
        data: c.data,
        duration: Math.round(c.duration * this._timescale / 1e6),
        isKeyframe: c.isKeyframe,
        compositionTimeOffset: 0
      }));
      const segment = this._muxer.muxSegment(muxerSamples, this._baseDecodeTime);
      this._baseDecodeTime += muxerSamples.reduce((sum, s) => sum + s.duration, 0);
      return segment;
    }
  };
  function extractParameterSetsFromInit(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const sets = [];
    for (let i = 0; i < data.byteLength - 4; i++) {
      if (view.getUint32(i) !== 1752589123) continue;
      const payload = i + 4;
      if (payload + 23 > data.byteLength) break;
      const numArrays = data[payload + 22];
      let off = payload + 23;
      for (let a = 0; a < numArrays && off + 3 <= data.byteLength; a++) {
        off++;
        const numNalus = view.getUint16(off);
        off += 2;
        for (let n = 0; n < numNalus && off + 2 <= data.byteLength; n++) {
          const naluLen = view.getUint16(off);
          off += 2;
          if (off + naluLen <= data.byteLength) {
            sets.push(data.slice(off, off + naluLen));
          }
          off += naluLen;
        }
      }
      break;
    }
    return sets;
  }
  function rebaseSamplesToTfdt(samples, tfdt) {
    if (samples.length === 0) return tfdt ?? 0;
    if (tfdt === null) return samples[0].dts;
    const drift = samples[0].dts - tfdt;
    if (drift !== 0) {
      for (const s of samples) {
        s.dts -= drift;
        s.pts -= drift;
      }
    }
    return tfdt;
  }
  function extractTfdt(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const len = data.byteLength;
    const eachBox = (from, to, visit) => {
      let i = from;
      while (i + 8 <= to) {
        const size = view.getUint32(i);
        if (size < 8 || i + size > to) return;
        visit(view.getUint32(i + 4), i + 8, i + size);
        i += size;
      }
    };
    let tfdt = null;
    let trafCount = 0;
    eachBox(0, len, (type, start2, end) => {
      if (type !== 1836019558) return;
      eachBox(start2, end, (childType, childStart, childEnd) => {
        if (childType !== 1953653094) return;
        trafCount++;
        eachBox(childStart, childEnd, (boxType, boxStart, boxEnd) => {
          if (boxType !== 1952867444) return;
          const version = data[boxStart];
          if (version === 1 && boxStart + 12 <= boxEnd) {
            const hi = view.getUint32(boxStart + 4);
            const lo = view.getUint32(boxStart + 8);
            const value = hi * 4294967296 + lo;
            tfdt = Number.isSafeInteger(value) ? value : null;
          } else if (version === 0 && boxStart + 8 <= boxEnd) {
            tfdt = view.getUint32(boxStart + 4);
          }
        });
      });
    });
    return trafCount === 1 ? tfdt : null;
  }
  var TranscodeWorkerClient = class {
    constructor(config) {
      this._ready = false;
      this._initParsed = false;
      this._initResult = null;
      this._segmentId = 0;
      this._pendingResolves = /* @__PURE__ */ new Map();
      this._pendingPrepareInit = /* @__PURE__ */ new Map();
      this._lastPerfStats = null;
      this._readyPromise = new Promise((resolve) => {
        this._readyResolve = resolve;
      });
      this._initParsedPromise = new Promise((resolve, reject) => {
        this._initParsedResolve = resolve;
        this._initParsedReject = reject;
      });
      const { workerUrl: _, ...transcoderConfig } = config;
      this._workerReady = loadWorker(config.workerUrl).then((worker) => {
        worker.onmessage = (e) => this._onMessage(e.data);
        worker.onerror = (e) => {
          log.error("Worker error:", e.message);
        };
        worker.postMessage({ type: "init", config: transcoderConfig });
        return worker;
      });
    }
    get isInitialized() {
      return this._ready;
    }
    get isInitParsed() {
      return this._initParsed;
    }
    get initResult() {
      return this._initResult;
    }
    get lastPerfStats() {
      return this._lastPerfStats;
    }
    /** Wait for the WASM decoder to be ready inside the worker */
    async waitReady() {
      await this._workerReady;
      return this._readyPromise;
    }
    /** Send an init segment (ftyp + moov) to the worker for parsing */
    async processInitSegment(data) {
      const worker = await this._workerReady;
      worker.postMessage(
        { type: "initSegment", data: data.buffer },
        [data.buffer]
      );
      return this._initParsedPromise;
    }
    /**
     * Process an HEVC init segment and return a matching H.264 fMP4 init
     * segment (warmup-encoder path inside the worker). Required by
     * transmuxer plugins that must hand an init segment back to the host
     * player before any media has been seen (Shaka 4.x's Transmuxer
     * contract).
     */
    async prepareInit(data) {
      const worker = await this._workerReady;
      const id = this._segmentId++;
      return new Promise((resolve, reject) => {
        this._pendingPrepareInit.set(id, { resolve, reject });
        worker.postMessage(
          { type: "prepareInit", data: data.buffer, id },
          [data.buffer]
        );
      });
    }
    /** Send a media segment to the worker for transcoding */
    async processMediaSegment(data) {
      const worker = await this._workerReady;
      const id = this._segmentId++;
      return new Promise((resolve, reject) => {
        this._pendingResolves.set(id, { resolve, reject });
        worker.postMessage(
          { type: "mediaSegment", data: data.buffer, id },
          [data.buffer]
        );
      });
    }
    /** Send a media segment for streaming transcoding — onChunk called for each partial result */
    async processMediaSegmentStreaming(data, onChunk) {
      const worker = await this._workerReady;
      const id = this._segmentId++;
      return new Promise((resolve, reject) => {
        let chainPromise = Promise.resolve();
        const handler = (e) => {
          const msg = e.data;
          if (msg.id !== id) return;
          if (msg.type === "partialTranscoded") {
            const init = msg.initSegment ? new Uint8Array(msg.initSegment) : null;
            if (init && !this._initResult) {
              this._initResult = {
                initSegment: init,
                codec: msg.codec || "avc1.640033"
              };
            }
            const h264 = new Uint8Array(msg.h264);
            chainPromise = chainPromise.then(() => onChunk(h264, init, msg.codec ?? null));
          } else if (msg.type === "streamingDone") {
            worker.removeEventListener("message", handler);
            const perf = msg.perf;
            if (perf) {
              this._lastPerfStats = perf;
              const totalMs = perf.demuxMs + perf.decodeMs + perf.encodeMs;
              if (totalMs > 0) {
                publishSegmentStat({
                  totalMs,
                  segDurMs: perf.segDurMs,
                  speedX: perf.segDurMs / totalMs,
                  frames: perf.frames,
                  width: perf.width,
                  height: perf.height
                });
              }
            }
            chainPromise.then(() => resolve()).catch(reject);
          } else if (msg.type === "error") {
            worker.removeEventListener("message", handler);
            chainPromise.then(() => reject(new Error(msg.message))).catch(reject);
          }
        };
        worker.addEventListener("message", handler);
        worker.postMessage(
          { type: "mediaSegmentStreaming", data: data.buffer, id },
          [data.buffer]
        );
      });
    }
    /** Abort current transcoding, reset state for seek */
    abort() {
      for (const [, { reject }] of this._pendingResolves) {
        reject(new Error("Aborted"));
      }
      this._pendingResolves.clear();
      for (const [, { reject }] of this._pendingPrepareInit) {
        reject(new Error("Aborted"));
      }
      this._pendingPrepareInit.clear();
      this._segmentId = 0;
      this._ready = false;
      this._readyPromise = new Promise((resolve) => {
        this._readyResolve = resolve;
      });
      this._initParsed = false;
      this._initResult = null;
      this._initParsedPromise = new Promise((resolve, reject) => {
        this._initParsedResolve = resolve;
        this._initParsedReject = reject;
      });
      this._workerReady.then((worker) => worker.postMessage({ type: "abort" }));
    }
    /** Destroy the worker */
    destroy() {
      this._pendingResolves.clear();
      this._pendingPrepareInit.clear();
      this._workerReady.then((worker) => {
        worker.postMessage({ type: "destroy" });
        worker.terminate();
      });
    }
    _onMessage(msg) {
      switch (msg.type) {
        case "ready":
          this._ready = true;
          this._readyResolve();
          break;
        case "initParsed":
          this._initParsed = true;
          this._initParsedResolve();
          break;
        case "initPrepared": {
          const id = msg.id;
          const pending = this._pendingPrepareInit.get(id);
          if (!pending) break;
          this._pendingPrepareInit.delete(id);
          const result = {
            initSegment: new Uint8Array(msg.initSegment),
            codec: msg.codec
          };
          if (!this._initResult) this._initResult = result;
          pending.resolve(result);
          break;
        }
        case "transcoded": {
          const id = msg.id;
          const perf = msg.perf;
          if (perf) {
            this._lastPerfStats = perf;
            const totalMs = perf.demuxMs + perf.decodeMs + perf.encodeMs;
            log.debug(`Segment #${id} transcoded in ${totalMs.toFixed(0)}ms (${perf.frames}f \u2014 demux:${perf.demuxMs.toFixed(0)}ms decode:${perf.decodeMs.toFixed(0)}ms encode:${perf.encodeMs.toFixed(0)}ms)`);
            if (totalMs > 0) {
              publishSegmentStat({
                totalMs,
                segDurMs: perf.segDurMs,
                speedX: perf.segDurMs / totalMs,
                frames: perf.frames,
                width: perf.width,
                height: perf.height
              });
            }
          }
          const pending = this._pendingResolves.get(id);
          if (!pending) break;
          this._pendingResolves.delete(id);
          if (msg.initSegment && !this._initResult) {
            this._initResult = {
              initSegment: new Uint8Array(msg.initSegment),
              codec: msg.codec || "avc1.640033"
            };
          }
          const h264 = msg.h264 ? new Uint8Array(msg.h264) : null;
          pending.resolve(h264);
          break;
        }
        case "error": {
          const id = msg.id;
          const pending = this._pendingResolves.get(id);
          if (pending) {
            this._pendingResolves.delete(id);
            pending.reject(new Error(msg.message));
            break;
          }
          const prepareInitPending = this._pendingPrepareInit.get(id);
          if (prepareInitPending) {
            this._pendingPrepareInit.delete(id);
            prepareInitPending.reject(new Error(msg.message));
            break;
          }
          if (id === -1 && !this._initParsed) {
            this._initParsedReject(new Error(msg.message));
          } else {
            log.error(msg.message);
          }
          break;
        }
        case "aborted":
          this._ready = true;
          this._readyResolve();
          break;
      }
    }
  };
  async function loadWorker(workerUrl) {
    const sameOrigin = typeof location === "undefined" || new URL(workerUrl, location.href).origin === location.origin;
    if (sameOrigin) return new Worker(workerUrl);
    const code = await (await fetch(workerUrl)).text();
    const blobUrl = URL.createObjectURL(
      new Blob([code], { type: "application/javascript" })
    );
    return new Worker(blobUrl);
  }
  var HEVC_DETECT_RE = /hev1|hvc1/i;
  var HEVC_CODEC_RE = /hev1[^"',]*|hvc1[^"',]*/gi;
  var TS_OFFSET_FLUSH_THRESHOLD_S = 0.5;
  var AUDIO_CODEC_PREFIXES = ["mp4a", "ac-3", "ec-3", "opus", "mp3", "alac", "flac", "vorbis"];
  function isMuxedHevcMime(mimeType) {
    if (!HEVC_DETECT_RE.test(mimeType)) return false;
    const m = /codecs\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(mimeType);
    const list = (m?.[1] ?? m?.[2] ?? "").split(",").map((c) => c.trim().toLowerCase());
    const hasHevc = list.some((c) => c.startsWith("hev1") || c.startsWith("hvc1"));
    const hasAudio = list.some((c) => AUDIO_CODEC_PREFIXES.some((a) => c.startsWith(a)));
    return hasHevc && hasAudio;
  }
  function getMediaSourceConstructor() {
    const g = globalThis;
    return g.MediaSource ?? g.ManagedMediaSource ?? null;
  }
  var interceptState = null;
  function installMSEIntercept(config = {}) {
    if (config.logLevel) setLogLevel(config.logLevel);
    if (typeof MediaSource === "undefined") {
      log.warn("MediaSource is not available in this browser \u2014 MSE intercept not installed");
      return;
    }
    if (interceptState?.active) {
      Object.assign(interceptState.config, config);
      return;
    }
    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    const originalIsTypeSupported = MediaSource.isTypeSupported;
    let originalDecodingInfo = null;
    interceptState = {
      active: true,
      originalAddSourceBuffer,
      originalIsTypeSupported,
      originalDecodingInfo: null,
      config
    };
    MediaSource.isTypeSupported = function(mimeType) {
      if (HEVC_DETECT_RE.test(mimeType)) {
        const h264Codec = hevcMimeToH264Codec(mimeType);
        const h264Mime = mimeType.replace(HEVC_CODEC_RE, h264Codec);
        const result = originalIsTypeSupported.call(MediaSource, h264Mime);
        log.debug(`isTypeSupported("${mimeType}") \u2192 "${h264Mime}" \u2192 ${result}`);
        return result;
      }
      return originalIsTypeSupported.call(MediaSource, mimeType);
    };
    if (typeof navigator !== "undefined" && navigator.mediaCapabilities) {
      originalDecodingInfo = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
      interceptState.originalDecodingInfo = originalDecodingInfo;
      navigator.mediaCapabilities.decodingInfo = async function(cfg) {
        if (cfg.video?.contentType && HEVC_DETECT_RE.test(cfg.video.contentType)) {
          const h264Codec = hevcMimeToH264Codec(cfg.video.contentType);
          const h264Type = cfg.video.contentType.replace(HEVC_CODEC_RE, h264Codec);
          const h264Config = { ...cfg, video: { ...cfg.video, contentType: h264Type } };
          return originalDecodingInfo(h264Config);
        }
        return originalDecodingInfo(cfg);
      };
    }
    MediaSource.prototype.addSourceBuffer = function(mimeType) {
      if (!HEVC_DETECT_RE.test(mimeType)) {
        return originalAddSourceBuffer.call(this, mimeType);
      }
      const muxed = isMuxedHevcMime(mimeType);
      const h264Codec = hevcMimeToH264Codec(mimeType);
      const h264Mime = muxed ? `video/mp4; codecs="${h264Codec},mp4a.40.2"` : `video/mp4; codecs="${h264Codec}"`;
      log.info(`addSourceBuffer("${mimeType}") \u2192 creating ${muxed ? "A/V" : "H.264"} proxy with ${h264Mime}`);
      const realSB = originalAddSourceBuffer.call(this, h264Mime);
      return createTranscodingProxy(realSB, interceptState.config, muxed);
    };
  }
  function uninstallMSEIntercept() {
    if (!interceptState?.active) return;
    MediaSource.prototype.addSourceBuffer = interceptState.originalAddSourceBuffer;
    MediaSource.isTypeSupported = interceptState.originalIsTypeSupported;
    if (interceptState.originalDecodingInfo && navigator.mediaCapabilities) {
      navigator.mediaCapabilities.decodingInfo = interceptState.originalDecodingInfo;
    }
    interceptState.active = false;
    interceptState = null;
  }
  function shouldFlushOnTimestampOffset(delta, hasQueuedSegments, initParsed) {
    return Math.abs(delta) >= TS_OFFSET_FLUSH_THRESHOLD_S && hasQueuedSegments && initParsed;
  }
  function createTranscodingProxy(realSB, config, muxed = false) {
    const useWorker = !!config.workerUrl && !muxed;
    let workerClient = null;
    let transcoder = null;
    let initParsed = false;
    let initAppended = false;
    let lastInitSegment = null;
    let fakeUpdating = false;
    const queue = [];
    let processing = false;
    let abortGeneration = 0;
    let cachedInitData = null;
    const MAX_QUEUE_BEFORE_BACKPRESSURE = 2;
    if (useWorker) {
      workerClient = new TranscodeWorkerClient({
        workerUrl: config.workerUrl,
        wasmUrl: config.wasmUrl,
        wasmBinaryUrl: config.wasmBinaryUrl,
        fps: config.fps,
        bitrate: config.bitrate
      });
      workerClient.waitReady().then(() => {
        log.info("Worker transcoder ready");
      }).catch((err) => {
        log.error("Worker init failed:", err?.message ?? err);
      });
    } else {
      transcoder = new SegmentTranscoder(config);
      transcoder.init().catch((err) => {
        log.error(
          "Main-thread transcoder init failed:",
          err?.message ?? err,
          err?.stack
        );
      });
    }
    const listeners2 = /* @__PURE__ */ new Map();
    function dispatchOnSB(type) {
      log.debug(`dispatch "${type}" (listeners: ${listeners2.get(type)?.size ?? 0}, queue: ${queue.length}, processing: ${processing})`);
      const set = listeners2.get(type);
      if (set) {
        const evt = new Event(type);
        for (const fn of set) {
          if (typeof fn === "function") fn.call(realSB, evt);
          else fn.handleEvent(evt);
        }
      }
      const onProp = realSB[`__hevc_on${type}`];
      if (typeof onProp === "function") onProp.call(realSB, new Event(type));
    }
    const realAppend = realSB.appendBuffer.bind(realSB);
    const realAbort = realSB.abort.bind(realSB);
    const realAddEventListener = realSB.addEventListener.bind(realSB);
    const updatingGetter = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, "updating").get;
    function waitForRealUpdateEnd() {
      return new Promise((resolve) => {
        if (!updatingGetter.call(realSB)) {
          resolve();
          return;
        }
        realAddEventListener("updateend", () => resolve(), { once: true });
      });
    }
    Object.defineProperty(realSB, "appendBuffer", {
      value: function(data) {
        const bytes = toUint8Array(data);
        log.debug(`appendBuffer(${bytes.byteLength}B) queued (queue: ${queue.length})`);
        queue.push(bytes);
        fakeUpdating = true;
        dispatchOnSB("updatestart");
        if (queue.length < MAX_QUEUE_BEFORE_BACKPRESSURE && !config.strictAppendProgress) {
          fakeUpdating = false;
          dispatchOnSB("update");
          dispatchOnSB("updateend");
        }
        processNext(realSB);
      },
      writable: true,
      configurable: true
    });
    Object.defineProperty(realSB, "abort", {
      value: function() {
        abortGeneration++;
        queue.length = 0;
        processing = false;
        fakeUpdating = false;
        initParsed = false;
        initAppended = false;
        if (workerClient) workerClient.abort();
        log.debug("abort() \u2014 queue + transcoder reset (gen=" + abortGeneration + ")");
        realAbort();
      },
      writable: true,
      configurable: true
    });
    Object.defineProperty(realSB, "addEventListener", {
      value: function(type, fn, options) {
        if (!listeners2.has(type)) listeners2.set(type, /* @__PURE__ */ new Set());
        listeners2.get(type).add(fn);
      },
      writable: true,
      configurable: true
    });
    Object.defineProperty(realSB, "removeEventListener", {
      value: function(type, fn) {
        listeners2.get(type)?.delete(fn);
      },
      writable: true,
      configurable: true
    });
    const realRemove = realSB.remove.bind(realSB);
    Object.defineProperty(realSB, "remove", {
      value: function(start2, end) {
        dispatchOnSB("updatestart");
        realRemove(start2, end);
        realAddEventListener("updateend", () => {
          dispatchOnSB("update");
          dispatchOnSB("updateend");
        }, { once: true });
      },
      writable: true,
      configurable: true
    });
    const realChangeType = realSB.changeType?.bind(realSB);
    if (realChangeType) {
      Object.defineProperty(realSB, "changeType", {
        value: function(mimeType) {
          if (HEVC_DETECT_RE.test(mimeType)) {
            const h264Mime = `video/mp4; codecs="${hevcMimeToH264Codec(mimeType)}"`;
            log.debug(`changeType("${mimeType}") \u2192 "${h264Mime}"`);
            realChangeType(h264Mime);
            return;
          }
          realChangeType(mimeType);
        },
        writable: true,
        configurable: true
      });
    }
    Object.defineProperty(realSB, "updating", {
      get() {
        return fakeUpdating || updatingGetter.call(realSB);
      },
      configurable: true
    });
    const tsOffsetDesc = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, "timestampOffset");
    Object.defineProperty(realSB, "timestampOffset", {
      get() {
        return tsOffsetDesc.get.call(realSB);
      },
      set(value) {
        const old = tsOffsetDesc.get.call(realSB);
        if (shouldFlushOnTimestampOffset(value - old, queue.length > 0, initParsed)) {
          log.debug(`timestampOffset changed (${old} \u2192 ${value}) \u2014 flushing queue`);
          abortGeneration++;
          queue.length = 0;
          processing = false;
          initParsed = false;
          initAppended = false;
          if (workerClient) workerClient.abort();
          if (fakeUpdating) {
            fakeUpdating = false;
            dispatchOnSB("update");
            dispatchOnSB("updateend");
          }
        } else if (value !== old) {
          log.debug(`timestampOffset ${old} \u2192 ${value} (pass-through)`);
        }
        tsOffsetDesc.set.call(realSB, value);
      },
      configurable: true
    });
    async function transcodeInit(segment) {
      if (workerClient) {
        await workerClient.waitReady();
        await workerClient.processInitSegment(segment);
      } else {
        while (!transcoder.isInitialized) await new Promise((r) => setTimeout(r, 10));
        await transcoder.processInitSegment(segment);
      }
    }
    async function transcodeMediaStreaming(segment, onPartial) {
      if (workerClient) {
        return workerClient.processMediaSegmentStreaming(segment, onPartial);
      }
      return transcoder.processMediaSegmentStreaming(segment, (h264, init) => {
        return onPartial(h264, init?.initSegment ?? null, init?.codec ?? null);
      });
    }
    async function processNext(target) {
      if (processing) return;
      processing = true;
      const myGeneration = abortGeneration;
      try {
        while (queue.length > 0) {
          if (abortGeneration !== myGeneration) return;
          const segment = queue.shift();
          if (updatingGetter.call(realSB)) {
            await waitForRealUpdateEnd();
            if (abortGeneration !== myGeneration) return;
          }
          const isInit = isInitSegment(segment);
          if (isInit || !initParsed) {
            const initData = isInit ? segment : cachedInitData;
            if (!initData) {
              log.error("No init segment available \u2014 cannot process media");
              continue;
            }
            cachedInitData = new Uint8Array(initData);
            await transcodeInit(initData);
            if (abortGeneration !== myGeneration) return;
            initParsed = true;
            initAppended = false;
            log.debug("Init segment parsed");
            if (isInit) {
              if (fakeUpdating) {
                fakeUpdating = false;
                dispatchOnSB("update");
                dispatchOnSB("updateend");
              }
              continue;
            }
          }
          if (muxed) {
            log.debug(`Transcoding segment (${segment.byteLength}B) [muxed A/V]...`);
            config.onTranscodeStart?.();
            const combined = await transcoder.processMediaSegment(segment);
            config.onTranscodeEnd?.();
            if (abortGeneration !== myGeneration) return;
            if (!initAppended) {
              const init = transcoder.initResult;
              if (init) {
                initAppended = true;
                lastInitSegment = init.initSegment;
                if (updatingGetter.call(realSB)) await waitForRealUpdateEnd();
                if (abortGeneration !== myGeneration) return;
                realAppend(init.initSegment.buffer);
                await waitForRealUpdateEnd();
                if (abortGeneration !== myGeneration) return;
                log.debug("A/V init segment appended");
              }
            }
            if (combined) {
              if (updatingGetter.call(realSB)) await waitForRealUpdateEnd();
              if (abortGeneration !== myGeneration) return;
              realAppend(combined.buffer);
              await waitForRealUpdateEnd();
            }
            if (fakeUpdating) {
              fakeUpdating = false;
              dispatchOnSB("update");
              dispatchOnSB("updateend");
            }
            continue;
          }
          log.debug(`Transcoding segment (${segment.byteLength}B) [streaming]...`);
          config.onTranscodeStart?.();
          let chunkCount = 0;
          let firstChunkEmitted = false;
          await transcodeMediaStreaming(segment, async (h264, initSeg, _codec) => {
            if (abortGeneration !== myGeneration) return;
            if (initSeg && !initAppended) {
              initAppended = true;
              lastInitSegment = initSeg;
              if (updatingGetter.call(realSB)) await waitForRealUpdateEnd();
              if (abortGeneration !== myGeneration) return;
              realAppend(initSeg.buffer);
              await waitForRealUpdateEnd();
              if (abortGeneration !== myGeneration) return;
              log.debug("H.264 init segment appended [streaming]");
            }
            if (updatingGetter.call(realSB)) await waitForRealUpdateEnd();
            if (abortGeneration !== myGeneration) return;
            realAppend(h264.buffer);
            await waitForRealUpdateEnd();
            chunkCount++;
            if (!firstChunkEmitted) {
              firstChunkEmitted = true;
              if (fakeUpdating && (config.strictAppendProgress || queue.length < MAX_QUEUE_BEFORE_BACKPRESSURE)) {
                fakeUpdating = false;
                dispatchOnSB("update");
                dispatchOnSB("updateend");
              }
            }
          });
          config.onTranscodeEnd?.();
          if (abortGeneration !== myGeneration) return;
          const buffered = target.buffered;
          const end = buffered.length ? buffered.end(buffered.length - 1).toFixed(2) : "0";
          log.debug(`Streaming done (${chunkCount} chunks), buffered: ${end}s`);
          if (fakeUpdating && !config.strictAppendProgress && queue.length < MAX_QUEUE_BEFORE_BACKPRESSURE) {
            fakeUpdating = false;
            dispatchOnSB("update");
            dispatchOnSB("updateend");
          }
        }
      } catch (err) {
        if (abortGeneration !== myGeneration) return;
        log.error(
          "Transcoding error:",
          err?.message ?? err,
          err?.stack
        );
        fakeUpdating = false;
        dispatchOnSB("error");
      } finally {
        if (abortGeneration === myGeneration) {
          processing = false;
          if (fakeUpdating) {
            fakeUpdating = false;
            dispatchOnSB("update");
            dispatchOnSB("updateend");
          }
        }
      }
    }
    return realSB;
  }
  function isInitSegment(data) {
    if (data.byteLength < 8) return false;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const boxType = view.getUint32(4);
    return boxType === 1718909296 || boxType === 1836019574;
  }
  function toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return new Uint8Array(data);
  }
  var DEFAULTS = {
    targetSpeedX: 1.3,
    raiseAfter: 6,
    lowerAfter: 1,
    measureWindow: 2
  };
  var ComputeAwareDecider = class {
    constructor(config = {}) {
      this.window = [];
      this.consecutiveLow = 0;
      this.consecutiveHigh = 0;
      this.capIndex_ = null;
      this.ladderSize_ = 0;
      this.prevCapIndex_ = null;
      this.prevWindow_ = [];
      this.prevConsecutiveLow_ = 0;
      this.prevConsecutiveHigh_ = 0;
      this.hasRevertablePoint_ = false;
      this.cfg = {
        targetSpeedX: config.targetSpeedX ?? DEFAULTS.targetSpeedX,
        raiseAfter: config.raiseAfter ?? DEFAULTS.raiseAfter,
        lowerAfter: config.lowerAfter ?? DEFAULTS.lowerAfter,
        measureWindow: config.measureWindow ?? DEFAULTS.measureWindow
      };
      if (this.cfg.targetSpeedX <= 1) {
        throw new Error("targetSpeedX must be > 1.0 (need headroom over real-time to raise)");
      }
      if (this.cfg.measureWindow < 1) throw new Error("measureWindow must be >= 1");
      if (this.cfg.raiseAfter < 1 || this.cfg.lowerAfter < 1) {
        throw new Error("raiseAfter / lowerAfter must be >= 1");
      }
    }
    /** Set or update the number of available variants. Must be called at least once before observe(). */
    setLadderSize(n) {
      if (n < 1) throw new Error("ladderSize must be >= 1");
      this.ladderSize_ = n;
      if (this.capIndex_ != null && this.capIndex_ >= n) {
        this.capIndex_ = n - 1;
      }
    }
    get currentCap() {
      return this.capIndex_;
    }
    get ladderSize() {
      return this.ladderSize_;
    }
    /**
     * Feed one speedX measurement plus the player's currently-active variant
     * index (used as the starting point on first activation, per the
     * "subtractive only on first activation" rule).
     *
     * Returns the decision: a `capIndex` plus the reason. The adapter applies
     * the cap to the player only when `reason` is "lower" or "raise".
     */
    observe(speedX, currentVariantIdx) {
      if (this.ladderSize_ === 0) {
        return { capIndex: this.capIndex_, avgSpeedX: speedX, reason: "init" };
      }
      this.window.push(speedX);
      if (this.window.length > this.cfg.measureWindow) this.window.shift();
      if (this.window.length < this.cfg.measureWindow) {
        return { capIndex: this.capIndex_, avgSpeedX: avg(this.window), reason: "init" };
      }
      const avgSpeed = avg(this.window);
      if (avgSpeed < 1) {
        this.consecutiveLow++;
        this.consecutiveHigh = 0;
        if (this.consecutiveLow >= this.cfg.lowerAfter) {
          const base = this.capIndex_ ?? clamp(currentVariantIdx, 0, this.ladderSize_ - 1);
          if (base > 0) {
            this.snapshotForRevert();
            this.capIndex_ = base - 1;
            this.resetAfterChange();
            return { capIndex: this.capIndex_, avgSpeedX: avgSpeed, reason: "lower" };
          }
          this.consecutiveLow = 0;
        }
      } else if (avgSpeed > this.cfg.targetSpeedX) {
        this.consecutiveHigh++;
        this.consecutiveLow = 0;
        if (this.consecutiveHigh >= this.cfg.raiseAfter) {
          if (this.capIndex_ != null && this.capIndex_ < this.ladderSize_ - 1) {
            this.snapshotForRevert();
            this.capIndex_ = this.capIndex_ + 1;
            this.resetAfterChange();
            return { capIndex: this.capIndex_, avgSpeedX: avgSpeed, reason: "raise" };
          }
          this.consecutiveHigh = 0;
        }
      } else {
        this.consecutiveLow = 0;
        this.consecutiveHigh = 0;
      }
      return { capIndex: this.capIndex_, avgSpeedX: avgSpeed, reason: "hold" };
    }
    /**
     * Roll back the most recent "lower" or "raise" decision. Adapters call
     * this when applying the cap to the host player throws — so the decider
     * state stays in sync with what's actually configured on the player.
     * Safe to call when no decision has happened yet (no-op).
     */
    revertLastDecision() {
      if (!this.hasRevertablePoint_) return;
      this.capIndex_ = this.prevCapIndex_;
      this.window = [...this.prevWindow_];
      this.consecutiveLow = this.prevConsecutiveLow_;
      this.consecutiveHigh = this.prevConsecutiveHigh_;
      this.hasRevertablePoint_ = false;
    }
    /** Test/debug — reset everything except the configured thresholds. */
    reset() {
      this.window = [];
      this.consecutiveLow = 0;
      this.consecutiveHigh = 0;
      this.capIndex_ = null;
      this.hasRevertablePoint_ = false;
    }
    snapshotForRevert() {
      this.prevCapIndex_ = this.capIndex_;
      this.prevWindow_ = [...this.window];
      this.prevConsecutiveLow_ = this.consecutiveLow;
      this.prevConsecutiveHigh_ = this.consecutiveHigh;
      this.hasRevertablePoint_ = true;
    }
    resetAfterChange() {
      this.window = [];
      this.consecutiveLow = 0;
      this.consecutiveHigh = 0;
    }
  };
  function avg(arr) {
    if (arr.length === 0) return 0;
    let sum = 0;
    for (const v of arr) sum += v;
    return sum / arr.length;
  }
  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  // packages/hlsjs-plugin/src/compute-aware.ts
  function attachHlsComputeAware(hls, options = {}) {
    const { onObservation, ...deciderConfig } = options;
    const decider = new ComputeAwareDecider(deciderConfig);
    const unsubscribe = subscribeSegmentStat((stat) => {
      const levels = hls?.levels ?? [];
      if (levels.length === 0) return;
      decider.setLadderSize(levels.length);
      const currentIdx = typeof hls.currentLevel === "number" && hls.currentLevel >= 0 ? hls.currentLevel : levels.length - 1;
      const decision = decider.observe(stat.speedX, currentIdx);
      if (onObservation) {
        try {
          onObservation(stat, decision.avgSpeedX, decision.capIndex, decision.reason);
        } catch {
        }
      }
      if (decision.reason === "lower" || decision.reason === "raise") {
        if (decision.capIndex == null) return;
        try {
          hls.autoLevelCapping = decision.capIndex;
        } catch (err) {
          decider.revertLastDecision();
          console.warn("[hevc.js/hls] applying autoLevelCapping failed, reverted decider:", err);
        }
      }
    });
    return unsubscribe;
  }

  // packages/hlsjs-plugin/src/plugin.ts
  async function hasNativeHevcSupport() {
    try {
      const MS = getMediaSourceConstructor();
      if (!MS) return false;
      if (!MS.isTypeSupported('video/mp4; codecs="hev1.1.6.L93.B0"')) return false;
      if (typeof MediaSource === "undefined") return true;
      return await new Promise((resolve) => {
        const ms = new MediaSource();
        const url = URL.createObjectURL(ms);
        const video = document.createElement("video");
        const timeout = setTimeout(() => {
          cleanup();
          resolve(false);
        }, 1e3);
        function cleanup() {
          clearTimeout(timeout);
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(url);
        }
        ms.addEventListener("sourceopen", () => {
          try {
            const sb = ms.addSourceBuffer('video/mp4; codecs="hev1.1.6.L93.B0"');
            ms.removeSourceBuffer(sb);
            cleanup();
            resolve(true);
          } catch {
            cleanup();
            resolve(false);
          }
        });
        video.src = url;
      });
    } catch {
      return false;
    }
  }
  async function attachHevcSupport(config = {}) {
    if (!config.forceTranscode && await hasNativeHevcSupport()) {
      console.log("[hevc.js/hls] Native HEVC support detected \u2014 transcoding not needed");
      return makeHandle(() => {
      }, config.adaptiveCompute);
    }
    if (typeof MediaSource === "undefined") {
      console.warn(
        "[hevc.js/hls] Classic MediaSource is not available in this browser \u2014 HEVC transcoding disabled."
      );
      return makeHandle(() => {
      }, config.adaptiveCompute);
    }
    if (!H264Encoder.isSupported()) {
      console.warn(
        "[hevc.js/hls] WebCodecs VideoEncoder not available. HEVC transcoding requires Chrome 94+ or equivalent."
      );
      return makeHandle(() => {
      }, config.adaptiveCompute);
    }
    const canEncode = await H264Encoder.checkSupport();
    if (!canEncode) {
      console.warn(
        "[hevc.js/hls] VideoEncoder exists but H.264 encoding is not supported. HEVC transcoding is not available in this browser."
      );
      return makeHandle(() => {
      }, config.adaptiveCompute);
    }
    console.log(
      config.forceTranscode ? "[hevc.js/hls] forceTranscode \u2014 installing WASM transcoder" : "[hevc.js/hls] No native HEVC support \u2014 installing WASM transcoder"
    );
    if (typeof globalThis.ManagedMediaSource !== "undefined") {
      console.warn(
        "[hevc.js/hls] ManagedMediaSource detected: pass `preferManagedMediaSource: false` to the Hls constructor, or hls.js will bypass the transcoding intercept."
      );
    }
    const { forceTranscode: _forceTranscode, adaptiveCompute, ...mseConfig } = config;
    installMSEIntercept({
      ...mseConfig,
      strictAppendProgress: true
    });
    return makeHandle(() => {
      uninstallMSEIntercept();
    }, adaptiveCompute);
  }
  function makeHandle(uninstall, adaptive) {
    let activeDetach = null;
    const tearDown = () => {
      activeDetach?.();
      activeDetach = null;
      uninstall();
    };
    const fn = (() => tearDown());
    fn.uninstall = tearDown;
    fn.attachComputeAware = (hls, runtimeOpts) => {
      if (adaptive === false) return () => {
      };
      activeDetach?.();
      const attachOpts = typeof adaptive === "object" ? adaptive : {};
      const opts = { ...attachOpts, ...runtimeOpts ?? {} };
      const detach = attachHlsComputeAware(hls, opts);
      activeDetach = detach;
      return () => {
        detach();
        if (activeDetach === detach) activeDetach = null;
      };
    };
    return fn;
  }
  return __toCommonJS(hls_entry_exports);
})();
//# sourceMappingURL=hls-bundle.js.map
