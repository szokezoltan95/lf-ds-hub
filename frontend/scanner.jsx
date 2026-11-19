import React, {useEffect, useRef, useState} from "react";

const intervalMs = 200;
const maxFrameEdge = 1600;
const decoderError = "Skener sa nepodarilo spustiť. Kód môžeš zadať ručne.";

// Camera frames are decoded in a local worker and never sent to the server.
export function CameraScanner({running, onDecode, onError}) {
  const video = useRef(null);
  const decode = useRef(onDecode);
  const error = useRef(onError);
  decode.current = onDecode;
  error.current = onError;
  const [devices, setDevices] = useState([]);
  const [device, setDevice] = useState("");
  const [ready, setReady] = useState(false);
  const [lightAvailable, setLightAvailable] = useState(false);
  const [lightEnabled, setLightEnabled] = useState(false);

  useEffect(() => {
    if (!running) return;
    const preview = video.current;
    let stopped = false;
    let stream, worker, timer;
    setReady(false);

    function stop() {
      stopped = true;
      clearTimeout(timer);
      worker?.terminate();
      stream?.getTracks().forEach(track => track.stop());
      if (preview.srcObject === stream) preview.srcObject = null;
    }

    function fail(message) {
      if (stopped) return;
      stop();
      error.current(message);
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Kamera nie je dostupná. Otvor hub cez HTTPS alebo zadaj kód ručne.");
        }
        const camera = device ? {deviceId: {exact: device}} : {facingMode: {ideal: "environment"}};
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {...camera, width: {ideal: 1280}, height: {ideal: 720}},
        });
        if (stopped) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.();
        setLightAvailable(Boolean(capabilities?.torch));
        setLightEnabled(false);
        try {
          if (track?.getCapabilities?.().focusMode?.includes("continuous")) {
            await track.applyConstraints({advanced: [{focusMode: "continuous"}]});
          }
        } catch { /* Continuous focus is optional. */ }
        if (stopped) return;
        preview.srcObject = stream;
        await preview.play();
        if (stopped) return;

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", {willReadFrequently: true});
        if (!context) throw new Error(decoderError);

        function capture() {
          if (stopped) return;
          if (preview.readyState < 2 || !preview.videoWidth || !preview.videoHeight) {
            timer = setTimeout(capture, intervalMs);
            return;
          }
          try {
            const scale = Math.min(1, maxFrameEdge / Math.max(preview.videoWidth, preview.videoHeight));
            const width = Math.max(1, Math.round(preview.videoWidth * scale));
            const height = Math.max(1, Math.round(preview.videoHeight * scale));
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            context.drawImage(preview, 0, 0, width, height);
            const {data} = context.getImageData(0, 0, width, height);
            worker.postMessage({pixels: data.buffer, width, height}, [data.buffer]);
          } catch {
            fail(decoderError);
          }
        }

        worker = new Worker(new URL("./scanner-worker.js", import.meta.url), {type: "module"});
        worker.onerror = () => fail(decoderError);
        worker.onmessage = ({data}) => {
          if (stopped) return;
          if (data.type === "error") {
            fail(decoderError);
          } else if (data.type === "ready") {
            setReady(true);
            capture();
          } else if (data.text) {
            stop();
            decode.current(data.text);
          } else {
            timer = setTimeout(capture, intervalMs);
          }
        };
        navigator.mediaDevices.enumerateDevices().then(inputs => {
          if (!stopped) setDevices(inputs.filter(input => input.kind === "videoinput"));
        }).catch(() => {});
      } catch (reason) {
        const messages = {
          NotAllowedError: "Prístup ku kamere bol zamietnutý. Povoľ ho v nastaveniach prehliadača alebo zadaj kód ručne.",
          NotFoundError: "Zariadenie nemá dostupnú kameru. Kód môžeš zadať ručne.",
          NotReadableError: "Kameru sa nepodarilo zapnúť. Skontroluj, či ju nepoužíva iná aplikácia.",
        };
        fail(messages[reason.name] || reason.message || "Kameru sa nepodarilo spustiť.");
      }
    }

    const hide = () => {
      if (document.hidden) fail("Kamera bola pozastavená. Môžeš ju znova zapnúť.");
    };
    document.addEventListener("visibilitychange", hide);
    start();
    return () => {
      document.removeEventListener("visibilitychange", hide);
      stop();
    };
  }, [running, device]);

  async function toggleLight() {
    const track = video.current?.srcObject?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      await track.applyConstraints({advanced: [{torch: !lightEnabled}]});
      setLightEnabled(value => !value);
    } catch { setLightAvailable(false); }
  }

  return <div className="scan-camera">
    <video ref={video} muted playsInline autoPlay aria-label="Náhľad kamery na skenovanie kódov" />
    {running && lightAvailable && <button type="button" className="scan-light-button" aria-label={lightEnabled ? "Vypnúť svetlo" : "Zapnúť svetlo"} aria-pressed={lightEnabled} onClick={toggleLight}>{lightEnabled ? "☀️" : "🔦"}</button>}
    {running && !ready && <p className="scan-camera-status" role="status">Spúšťa sa kamera…</p>}
    {running && devices.length > 1 && <label>Kamera<select value={device} onChange={event => setDevice(event.target.value)}>
      <option value="">Automaticky – zadná kamera</option>{devices.map((input, index) => <option key={input.deviceId} value={input.deviceId}>{input.label || "Kamera " + (index + 1)}</option>)}
    </select></label>}
  </div>;
}
