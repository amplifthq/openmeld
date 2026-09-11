import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace pbbp2. */
export namespace pbbp2 {

    /** Properties of a Header. */
    interface IHeader {

        /** Header key */
        key: string;

        /** Header value */
        value: string;
    }

    /** Represents a Header. */
    class Header implements IHeader {

        /**
         * Constructs a new Header.
         * @param [properties] Properties to set
         */
        constructor(properties?: pbbp2.IHeader);

        /** Header key. */
        public key: string;

        /** Header value. */
        public value: string;

        /**
         * Creates a new Header instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Header instance
         */
        public static create(properties?: pbbp2.IHeader): pbbp2.Header;

        /**
         * Encodes the specified Header message. Does not implicitly {@link pbbp2.Header.verify|verify} messages.
         * @param message Header message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: pbbp2.IHeader, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Header message, length delimited. Does not implicitly {@link pbbp2.Header.verify|verify} messages.
         * @param message Header message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: pbbp2.IHeader, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Header message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Header
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): pbbp2.Header;

        /**
         * Decodes a Header message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Header
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): pbbp2.Header;

        /**
         * Verifies a Header message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Header message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Header
         */
        public static fromObject(object: { [k: string]: any }): pbbp2.Header;

        /**
         * Creates a plain object from a Header message. Also converts values to other types if specified.
         * @param message Header
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: pbbp2.Header, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Header to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Header
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Frame. */
    interface IFrame {

        /** Frame SeqID */
        SeqID: number;

        /** Frame LogID */
        LogID: number;

        /** Frame service */
        service: number;

        /** Frame method */
        method: number;

        /** Frame headers */
        headers?: (pbbp2.IHeader[]|null);

        /** Frame payloadEncoding */
        payloadEncoding?: (string|null);

        /** Frame payloadType */
        payloadType?: (string|null);

        /** Frame payload */
        payload?: (Uint8Array|null);

        /** Frame LogIDNew */
        LogIDNew?: (string|null);
    }

    /** Represents a Frame. */
class Frame implements IFrame {

        /**
         * Constructs a new Frame.
         * @param [properties] Properties to set
         */
        constructor(properties?: pbbp2.IFrame);

        /** Frame SeqID. */
        public SeqID: number;

        /** Frame LogID. */
        public LogID: number;

        /** Frame service. */
        public service: number;

        /** Frame method. */
        public method: number;

        /** Frame headers. */
        public headers: pbbp2.IHeader[];

        /** Frame payloadEncoding. */
        public payloadEncoding: string;

        /** Frame payloadType. */
        public payloadType: string;

        /** Frame payload. */
        public payload: Uint8Array;

        /** Frame LogIDNew. */
        public LogIDNew: string;

        /**
         * Creates a new Frame instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Frame instance
         */
        public static create(properties?: pbbp2.IFrame): pbbp2.Frame;

        /**
         * Encodes the specified Frame message. Does not implicitly {@link pbbp2.Frame.verify|verify} messages.
         * @param message Frame message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: pbbp2.IFrame, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Frame message, length delimited. Does not implicitly {@link pbbp2.Frame.verify|verify} messages.
         * @param message Frame message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: pbbp2.IFrame, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Frame message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Frame
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): pbbp2.Frame;

        /**
         * Decodes a Frame message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Frame
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): pbbp2.Frame;

        /**
         * Verifies a Frame message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Frame message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Frame
         */
        public static fromObject(object: { [k: string]: any }): pbbp2.Frame;

        /**
         * Creates a plain object from a Frame message. Also converts values to other types if specified.
         * @param message Frame
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: pbbp2.Frame, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Frame to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Frame
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}
