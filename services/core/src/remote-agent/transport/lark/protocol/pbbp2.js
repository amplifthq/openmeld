// @ts-nocheck
/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
const $protobuf = require("protobufjs/minimal");

$protobuf.util.Long = undefined;
$protobuf.configure();

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const pbbp2 = $root.pbbp2 = (() => {
    /**
     * Namespace pbbp2.
     * @exports pbbp2
     * @namespace
     */
    const pbbp2 = {};

    pbbp2.Header = (function() {

        /**
         * Properties of a Header.
         * @memberof pbbp2
         * @interface IHeader
         * @property {string} key Header key
         * @property {string} value Header value
         */

        /**
         * Constructs a new Header.
         * @memberof pbbp2
         * @classdesc Represents a Header.
         * @implements IHeader
         * @constructor
         * @param {pbbp2.IHeader=} [properties] Properties to set
         */
        function Header(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Header key.
         * @member {string} key
         * @memberof pbbp2.Header
         * @instance
         */
        Header.prototype.key = "";

        /**
         * Header value.
         * @member {string} value
         * @memberof pbbp2.Header
         * @instance
         */
        Header.prototype.value = "";

        /**
         * Creates a new Header instance using the specified properties.
         * @function create
         * @memberof pbbp2.Header
         * @static
         * @param {pbbp2.IHeader=} [properties] Properties to set
         * @returns {pbbp2.Header} Header instance
         */
        Header.create = function create(properties) {
            return new Header(properties);
        };

        /**
         * Encodes the specified Header message. Does not implicitly {@link pbbp2.Header.verify|verify} messages.
         * @function encode
         * @memberof pbbp2.Header
         * @static
         * @param {pbbp2.IHeader} message Header message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Header.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.key);
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.value);
            return writer;
        };

        /**
         * Encodes the specified Header message, length delimited. Does not implicitly {@link pbbp2.Header.verify|verify} messages.
         * @function encodeDelimited
         * @memberof pbbp2.Header
         * @static
         * @param {pbbp2.IHeader} message Header message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Header.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a Header message from the specified reader or buffer.
         * @function decode
         * @memberof pbbp2.Header
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {pbbp2.Header} Header
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Header.decode = function decode(reader, length) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.pbbp2.Header();
            while (reader.pos < end) {
                let tag = reader.uint32();
                switch (tag >>> 3) {
                case 1: {
                        message.key = reader.string();
                        break;
                    }
                case 2: {
                        message.value = reader.string();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            if (!message.hasOwnProperty("key"))
                throw $util.ProtocolError("missing required 'key'", { instance: message });
            if (!message.hasOwnProperty("value"))
                throw $util.ProtocolError("missing required 'value'", { instance: message });
            return message;
        };

        /**
         * Decodes a Header message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof pbbp2.Header
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {pbbp2.Header} Header
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Header.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Header message.
         * @function verify
         * @memberof pbbp2.Header
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Header.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (!$util.isString(message.key))
                return "key: string expected";
            if (!$util.isString(message.value))
                return "value: string expected";
            return null;
        };

        /**
         * Creates a Header message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof pbbp2.Header
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {pbbp2.Header} Header
         */
        Header.fromObject = function fromObject(object) {
            if (object instanceof $root.pbbp2.Header)
                return object;
            let message = new $root.pbbp2.Header();
            if (object.key != null)
                message.key = String(object.key);
            if (object.value != null)
                message.value = String(object.value);
            return message;
        };

        /**
         * Creates a plain object from a Header message. Also converts values to other types if specified.
         * @function toObject
         * @memberof pbbp2.Header
         * @static
         * @param {pbbp2.Header} message Header
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Header.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.key = "";
                object.value = "";
            }
            if (message.key != null && message.hasOwnProperty("key"))
                object.key = message.key;
            if (message.value != null && message.hasOwnProperty("value"))
                object.value = message.value;
            return object;
        };

        /**
         * Converts this Header to JSON.
         * @function toJSON
         * @memberof pbbp2.Header
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Header.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for Header
         * @function getTypeUrl
         * @memberof pbbp2.Header
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Header.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/pbbp2.Header";
        };

        return Header;
    })();

    pbbp2.Frame = (function() {

        /**
         * Properties of a Frame.
         * @memberof pbbp2
         * @interface IFrame
         * @property {number} SeqID Frame SeqID
         * @property {number} LogID Frame LogID
         * @property {number} service Frame service
         * @property {number} method Frame method
         * @property {Array.<pbbp2.IHeader>|null} [headers] Frame headers
         * @property {string|null} [payloadEncoding] Frame payloadEncoding
         * @property {string|null} [payloadType] Frame payloadType
         * @property {Uint8Array|null} [payload] Frame payload
         * @property {string|null} [LogIDNew] Frame LogIDNew
         */

        /**
         * Constructs a new Frame.
         * @memberof pbbp2
         * @classdesc Represents a Frame.
         * @implements IFrame
         * @constructor
         * @param {pbbp2.IFrame=} [properties] Properties to set
         */
        function Frame(properties) {
            this.headers = [];
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Frame SeqID.
         * @member {number} SeqID
         * @memberof pbbp2.Frame
         * @instance
         */
        Frame.prototype.SeqID = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * Frame LogID.
         * @member {number} LogID
         * @memberof pbbp2.Frame
         * @instance
         */
        Frame.prototype.LogID = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * Frame service.
         * @member {number} service
         * @memberof pbbp2.Frame
         * @instance
         */
        Frame.prototype.service = 0;

        /**
         * Frame method.
         * @member {number} method
         * @memberof pbbp2.Frame
         * @instance
         */
        Frame.prototype.method = 0;

        /**
         * Frame headers.
         * @member {Array.<pbbp2.IHeader>} headers
         * @memberof pbbp2.Frame
         * @instance
         */
        Frame.prototype.headers = $util.emptyArray;

        /**
         * Frame payloadEncoding.
         * @member {string} payloadEncoding
         * @memberof pbbp2.Frame
         * @instance
         */
        Frame.prototype.payloadEncoding = "";

        /**
         * Frame payloadType.
         * @member {string} payloadType
         * @memberof pbbp2.Frame
         * @instance
         */
        Frame.prototype.payloadType = "";

        /**
         * Frame payload.
         * @member {Uint8Array} payload
         * @memberof pbbp2.Frame
         * @instance
         */
        Frame.prototype.payload = $util.newBuffer([]);

        /**
         * Frame LogIDNew.
         * @member {string} LogIDNew
         * @memberof pbbp2.Frame
         * @instance
         */
        Frame.prototype.LogIDNew = "";

        /**
         * Creates a new Frame instance using the specified properties.
         * @function create
         * @memberof pbbp2.Frame
         * @static
         * @param {pbbp2.IFrame=} [properties] Properties to set
         * @returns {pbbp2.Frame} Frame instance
         */
        Frame.create = function create(properties) {
            return new Frame(properties);
        };

        /**
         * Encodes the specified Frame message. Does not implicitly {@link pbbp2.Frame.verify|verify} messages.
         * @function encode
         * @memberof pbbp2.Frame
         * @static
         * @param {pbbp2.IFrame} message Frame message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Frame.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            writer.uint32(/* id 1, wireType 0 =*/8).uint64(message.SeqID);
            writer.uint32(/* id 2, wireType 0 =*/16).uint64(message.LogID);
            writer.uint32(/* id 3, wireType 0 =*/24).int32(message.service);
            writer.uint32(/* id 4, wireType 0 =*/32).int32(message.method);
            if (message.headers != null && message.headers.length)
                for (let i = 0; i < message.headers.length; ++i)
                    $root.pbbp2.Header.encode(message.headers[i], writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
            if (message.payloadEncoding != null && Object.hasOwnProperty.call(message, "payloadEncoding"))
                writer.uint32(/* id 6, wireType 2 =*/50).string(message.payloadEncoding);
            if (message.payloadType != null && Object.hasOwnProperty.call(message, "payloadType"))
                writer.uint32(/* id 7, wireType 2 =*/58).string(message.payloadType);
            if (message.payload != null && Object.hasOwnProperty.call(message, "payload"))
                writer.uint32(/* id 8, wireType 2 =*/66).bytes(message.payload);
            if (message.LogIDNew != null && Object.hasOwnProperty.call(message, "LogIDNew"))
                writer.uint32(/* id 9, wireType 2 =*/74).string(message.LogIDNew);
            return writer;
        };

        /**
         * Encodes the specified Frame message, length delimited. Does not implicitly {@link pbbp2.Frame.verify|verify} messages.
         * @function encodeDelimited
         * @memberof pbbp2.Frame
         * @static
         * @param {pbbp2.IFrame} message Frame message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Frame.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a Frame message from the specified reader or buffer.
         * @function decode
         * @memberof pbbp2.Frame
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {pbbp2.Frame} Frame
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Frame.decode = function decode(reader, length) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.pbbp2.Frame();
            while (reader.pos < end) {
                let tag = reader.uint32();
                switch (tag >>> 3) {
                case 1: {
                        message.SeqID = reader.uint64();
                        break;
                    }
                case 2: {
                        message.LogID = reader.uint64();
                        break;
                    }
                case 3: {
                        message.service = reader.int32();
                        break;
                    }
                case 4: {
                        message.method = reader.int32();
                        break;
                    }
                case 5: {
                        if (!(message.headers && message.headers.length))
                            message.headers = [];
                        message.headers.push($root.pbbp2.Header.decode(reader, reader.uint32()));
                        break;
                    }
                case 6: {
                        message.payloadEncoding = reader.string();
                        break;
                    }
                case 7: {
                        message.payloadType = reader.string();
                        break;
                    }
                case 8: {
                        message.payload = reader.bytes();
                        break;
                    }
                case 9: {
                        message.LogIDNew = reader.string();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            if (!message.hasOwnProperty("SeqID"))
                throw $util.ProtocolError("missing required 'SeqID'", { instance: message });
            if (!message.hasOwnProperty("LogID"))
                throw $util.ProtocolError("missing required 'LogID'", { instance: message });
            if (!message.hasOwnProperty("service"))
                throw $util.ProtocolError("missing required 'service'", { instance: message });
            if (!message.hasOwnProperty("method"))
                throw $util.ProtocolError("missing required 'method'", { instance: message });
            return message;
        };

        /**
         * Decodes a Frame message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof pbbp2.Frame
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {pbbp2.Frame} Frame
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Frame.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Frame message.
         * @function verify
         * @memberof pbbp2.Frame
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Frame.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (!$util.isInteger(message.SeqID) && !(message.SeqID && $util.isInteger(message.SeqID.low) && $util.isInteger(message.SeqID.high)))
                return "SeqID: integer|Long expected";
            if (!$util.isInteger(message.LogID) && !(message.LogID && $util.isInteger(message.LogID.low) && $util.isInteger(message.LogID.high)))
                return "LogID: integer|Long expected";
            if (!$util.isInteger(message.service))
                return "service: integer expected";
            if (!$util.isInteger(message.method))
                return "method: integer expected";
            if (message.headers != null && message.hasOwnProperty("headers")) {
                if (!Array.isArray(message.headers))
                    return "headers: array expected";
                for (let i = 0; i < message.headers.length; ++i) {
                    let error = $root.pbbp2.Header.verify(message.headers[i]);
                    if (error)
                        return "headers." + error;
                }
            }
            if (message.payloadEncoding != null && message.hasOwnProperty("payloadEncoding"))
                if (!$util.isString(message.payloadEncoding))
                    return "payloadEncoding: string expected";
            if (message.payloadType != null && message.hasOwnProperty("payloadType"))
                if (!$util.isString(message.payloadType))
                    return "payloadType: string expected";
            if (message.payload != null && message.hasOwnProperty("payload"))
                if (!(message.payload && typeof message.payload.length === "number" || $util.isString(message.payload)))
                    return "payload: buffer expected";
            if (message.LogIDNew != null && message.hasOwnProperty("LogIDNew"))
                if (!$util.isString(message.LogIDNew))
                    return "LogIDNew: string expected";
            return null;
        };

        /**
         * Creates a Frame message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof pbbp2.Frame
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {pbbp2.Frame} Frame
         */
        Frame.fromObject = function fromObject(object) {
            if (object instanceof $root.pbbp2.Frame)
                return object;
            let message = new $root.pbbp2.Frame();
            if (object.SeqID != null)
                if ($util.Long)
                    (message.SeqID = $util.Long.fromValue(object.SeqID)).unsigned = true;
                else if (typeof object.SeqID === "string")
                    message.SeqID = parseInt(object.SeqID, 10);
                else if (typeof object.SeqID === "number")
                    message.SeqID = object.SeqID;
                else if (typeof object.SeqID === "object")
                    message.SeqID = new $util.LongBits(object.SeqID.low >>> 0, object.SeqID.high >>> 0).toNumber(true);
            if (object.LogID != null)
                if ($util.Long)
                    (message.LogID = $util.Long.fromValue(object.LogID)).unsigned = true;
                else if (typeof object.LogID === "string")
                    message.LogID = parseInt(object.LogID, 10);
                else if (typeof object.LogID === "number")
                    message.LogID = object.LogID;
                else if (typeof object.LogID === "object")
                    message.LogID = new $util.LongBits(object.LogID.low >>> 0, object.LogID.high >>> 0).toNumber(true);
            if (object.service != null)
                message.service = object.service | 0;
            if (object.method != null)
                message.method = object.method | 0;
            if (object.headers) {
                if (!Array.isArray(object.headers))
                    throw TypeError(".pbbp2.Frame.headers: array expected");
                message.headers = [];
                for (let i = 0; i < object.headers.length; ++i) {
                    if (typeof object.headers[i] !== "object")
                        throw TypeError(".pbbp2.Frame.headers: object expected");
                    message.headers[i] = $root.pbbp2.Header.fromObject(object.headers[i]);
                }
            }
            if (object.payloadEncoding != null)
                message.payloadEncoding = String(object.payloadEncoding);
            if (object.payloadType != null)
                message.payloadType = String(object.payloadType);
            if (object.payload != null)
                if (typeof object.payload === "string")
                    $util.base64.decode(object.payload, message.payload = $util.newBuffer($util.base64.length(object.payload)), 0);
                else if (object.payload.length >= 0)
                    message.payload = object.payload;
            if (object.LogIDNew != null)
                message.LogIDNew = String(object.LogIDNew);
            return message;
        };

        /**
         * Creates a plain object from a Frame message. Also converts values to other types if specified.
         * @function toObject
         * @memberof pbbp2.Frame
         * @static
         * @param {pbbp2.Frame} message Frame
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Frame.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.arrays || options.defaults)
                object.headers = [];
            if (options.defaults) {
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.SeqID = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.SeqID = options.longs === String ? "0" : 0;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.LogID = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.LogID = options.longs === String ? "0" : 0;
                object.service = 0;
                object.method = 0;
                object.payloadEncoding = "";
                object.payloadType = "";
                if (options.bytes === String)
                    object.payload = "";
                else {
                    object.payload = [];
                    if (options.bytes !== Array)
                        object.payload = $util.newBuffer(object.payload);
                }
                object.LogIDNew = "";
            }
            if (message.SeqID != null && message.hasOwnProperty("SeqID"))
                if (typeof message.SeqID === "number")
                    object.SeqID = options.longs === String ? String(message.SeqID) : message.SeqID;
                else
                    object.SeqID = options.longs === String ? $util.Long.prototype.toString.call(message.SeqID) : options.longs === Number ? new $util.LongBits(message.SeqID.low >>> 0, message.SeqID.high >>> 0).toNumber(true) : message.SeqID;
            if (message.LogID != null && message.hasOwnProperty("LogID"))
                if (typeof message.LogID === "number")
                    object.LogID = options.longs === String ? String(message.LogID) : message.LogID;
                else
                    object.LogID = options.longs === String ? $util.Long.prototype.toString.call(message.LogID) : options.longs === Number ? new $util.LongBits(message.LogID.low >>> 0, message.LogID.high >>> 0).toNumber(true) : message.LogID;
            if (message.service != null && message.hasOwnProperty("service"))
                object.service = message.service;
            if (message.method != null && message.hasOwnProperty("method"))
                object.method = message.method;
            if (message.headers && message.headers.length) {
                object.headers = [];
                for (let j = 0; j < message.headers.length; ++j)
                    object.headers[j] = $root.pbbp2.Header.toObject(message.headers[j], options);
            }
            if (message.payloadEncoding != null && message.hasOwnProperty("payloadEncoding"))
                object.payloadEncoding = message.payloadEncoding;
            if (message.payloadType != null && message.hasOwnProperty("payloadType"))
                object.payloadType = message.payloadType;
            if (message.payload != null && message.hasOwnProperty("payload"))
                object.payload = options.bytes === String ? $util.base64.encode(message.payload, 0, message.payload.length) : options.bytes === Array ? Array.prototype.slice.call(message.payload) : message.payload;
            if (message.LogIDNew != null && message.hasOwnProperty("LogIDNew"))
                object.LogIDNew = message.LogIDNew;
            return object;
        };

        /**
         * Converts this Frame to JSON.
         * @function toJSON
         * @memberof pbbp2.Frame
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Frame.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for Frame
         * @function getTypeUrl
         * @memberof pbbp2.Frame
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Frame.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/pbbp2.Frame";
        };

        return Frame;
    })();

    return pbbp2;
})();

export { $root as default };
