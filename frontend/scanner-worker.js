import {prepareZXingModule, readBarcodes} from "zxing-wasm/reader";
import readerWasm from "zxing-wasm/reader/zxing_reader.wasm?url";

const readerOptions = {
  formats: ["QRCodeModel1", "QRCodeModel2", "MicroQRCode", "Code128"],
  maxNumberOfSymbols: 1,
  tryHarder: true,
  tryRotate: true,
  // Keep GS1 element strings and their group separators for the existing API parser.
  textMode: "Plain",
};

try {
  await prepareZXingModule({
    overrides: {locateFile: () => readerWasm},
    fireImmediately: true,
  });
  self.onmessage = async ({data: {pixels, width, height}}) => {
    try {
      const frame = new ImageData(new Uint8ClampedArray(pixels), width, height);
      const [result] = await readBarcodes(frame, readerOptions);
      self.postMessage({type: "frame", text: result?.text || ""});
    } catch {
      self.postMessage({type: "error"});
    }
  };
  self.postMessage({type: "ready"});
} catch {
  self.postMessage({type: "error"});
}
