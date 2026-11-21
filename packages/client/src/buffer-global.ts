// @tinycloud/web-sdk 3.13 decodes the SIWE recap with Node's `Buffer`; a browser bundle has none, so sign-in would
// fail right after OpenKey approves. "buffer/" (trailing slash) is the npm package, not the Node builtin.
import { Buffer } from "buffer/";

globalThis.Buffer ??= Buffer as unknown as typeof globalThis.Buffer;
