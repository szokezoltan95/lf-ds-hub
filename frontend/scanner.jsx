import React,{useEffect,useRef,useState} from "react";

// Decode locally. Camera frames never leave the device.
export function CameraScanner({running,onDecode,onError}) {
  const video=useRef(null);
  const decode=useRef(onDecode),error=useRef(onError);
  decode.current=onDecode;error.current=onError;
  const [devices,setDevices]=useState([]);
  const [device,setDevice]=useState("");
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    if(!running) return;
    let disposed=false,stream,controls;
    setReady(false);
    const release=()=>{
      controls?.stop();
      stream?.getTracks().forEach(track=>track.stop());
      if(video.current) video.current.srcObject=null;
    };
    (async()=>{
      try {
        if(!navigator.mediaDevices?.getUserMedia) throw new Error("Kamera nie je dostupná. Otvor hub cez HTTPS alebo zadaj kód ručne.");
        const {BrowserMultiFormatReader}=await import("@zxing/browser");
        if(disposed) return;
        stream=await navigator.mediaDevices.getUserMedia({audio:false,video:device ? {deviceId:{exact:device}} : {facingMode:{ideal:"environment"}}});
        if(disposed){release();return;}
        const reader=new BrowserMultiFormatReader();
        controls=await reader.decodeFromStream(stream,video.current,(result)=>{
          if(result && !disposed) decode.current(result.getText());
        });
        if(disposed){release();return;}
        setReady(true);
        const inputs=await navigator.mediaDevices.enumerateDevices();
        if(!disposed) setDevices(inputs.filter(input=>input.kind==="videoinput"));
      } catch(reason){
        release();
        if(disposed) return;
        const messages={NotAllowedError:"Prístup ku kamere bol zamietnutý. Povoľ ho v nastaveniach prehliadača alebo zadaj kód ručne.",
          NotFoundError:"Zariadenie nemá dostupnú kameru. Kód môžeš zadať ručne.",NotReadableError:"Kameru sa nepodarilo zapnúť. Skontroluj, či ju nepoužíva iná aplikácia."};
        error.current(messages[reason.name] || reason.message || "Kameru sa nepodarilo spustiť.");
      }
    })();
    const hide=()=>{if(document.hidden){release();error.current("Kamera bola pozastavená. Môžeš ju znova zapnúť.");}};
    addEventListener("visibilitychange",hide);
    return ()=>{disposed=true;removeEventListener("visibilitychange",hide);release();};
  },[running,device]);
  return <div className="scan-camera">
    <video ref={video} muted playsInline autoPlay aria-label="Náhľad kamery na skenovanie kódov" />
    {running && !ready && <p className="scan-camera-status" role="status">Spúšťa sa kamera…</p>}
    {running && devices.length>1 && <label>Kamera<select value={device} onChange={event=>setDevice(event.target.value)}>
      <option value="">Automaticky – zadná kamera</option>{devices.map((input,index)=><option key={input.deviceId} value={input.deviceId}>{input.label || "Kamera "+(index+1)}</option>)}
    </select></label>}
  </div>;
}
