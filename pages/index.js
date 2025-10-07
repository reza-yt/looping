import { useEffect, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const coreVersion = "0.12.6";

const positionsMap = {
  "top-left": { x: 20, y: 20 },
  "top-right": { x: "(W-w-20)", y: 20 },
  "center": { x: "(W-w)/2", y: "(H-h)/2" },
  "bottom-left": { x: 20, y: "(H-h-20)" },
  "bottom-right": { x: "(W-w-20)", y: "(H-h-20)" },
};

export default function Home() {
  const [videoFile, setVideoFile] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [useExternalAudio, setUseExternalAudio] = useState(false);
  const [muteOriginal, setMuteOriginal] = useState(true);
  const [durationSec, setDurationSec] = useState(3600);
  const [volume, setVolume] = useState(80); // percent
  const [fadeIn, setFadeIn] = useState(true);
  const [fadeOut, setFadeOut] = useState(true);
  const [fadeDurMs, setFadeDurMs] = useState(500); // milliseconds
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);

  // watermark states
  const [wmText, setWmText] = useState("");
  const [wmFontSize, setWmFontSize] = useState(36);
  const [wmTextOpacity, setWmTextOpacity] = useState(50);
  const [wmPosition, setWmPosition] = useState("bottom-right");
  const [wmImage, setWmImage] = useState(null);
  const [wmImageOpacity, setWmImageOpacity] = useState(40);
  const [wmImageScale, setWmImageScale] = useState(100);
  const [fontFile, setFontFile] = useState(null);

  const ffmpegRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;
    const load = async () => {
      const baseURL = `https://unpkg.com/@ffmpeg/core@${coreVersion}/dist`;
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpeg.on("log", ({ message }) => {
        // console.log(message);
      });
      ffmpeg.on("progress", ({ progress }) => {
        setProgress(Math.round((progress ?? 0) * 100));
      });
      setLoaded(true);
    };
    load();
    return () => {
      try { ffmpeg.terminate(); } catch {}
    };
  }, []);

  function posExpr(baseW, baseH) {
    const pos = positionsMap[wmPosition] || positionsMap["bottom-right"];
    return { x: String(pos.x).replace("W", baseW).replace("H", baseH),
             y: String(pos.y).replace("W", baseW).replace("H", baseH)};
  }

  async function handleProcess(e) {
    e.preventDefault();
    setDownloadUrl(null);
    if (!videoFile) return alert("Upload video dulu");
    if (useExternalAudio && !audioFile) return alert("Centang audio eksternal tapi belum upload audionya");

    const ffmpeg = ffmpegRef.current;
    if (!loaded) return alert("FFmpeg belum siap. Tunggu sebentar dan coba lagi.");

    setProcessing(true);
    setProgress(0);

    // clean FS
    try {
      for (const f of await ffmpeg.listDir("/")) {
        if (f.name !== ".") await ffmpeg.deleteFile(f.name);
      }
    } catch {}

    // prepare inputs
    await ffmpeg.writeFile("video.mp4", await fetchFile(videoFile));
    if (useExternalAudio) {
      const aExt = audioFile.name.split(".").pop();
      await ffmpeg.writeFile(`audio.${aExt}`, await fetchFile(audioFile));
    }
    if (wmImage) {
      const imgExt = wmImage.name.split(".").pop();
      await ffmpeg.writeFile(`wm.${imgExt}`, await fetchFile(wmImage));
    }
    if (fontFile) {
      const fExt = fontFile.name.split(".").pop();
      await ffmpeg.writeFile(`font.${fExt}`, await fetchFile(fontFile));
    }

    const duration = Math.max(1, parseInt(durationSec || 0, 10));

    // Build ffmpeg command
    const args = [];
    args.push("-y");

    // Video input (loop indefinitely), trim to target duration
    args.push("-stream_loop", "-1", "-i", "video.mp4");

    let inputAudioName = null;
    if (useExternalAudio) {
      inputAudioName = audioFile.name.split(".").pop();
      inputAudioName = `audio.${inputAudioName}`;
      args.push("-stream_loop", "-1", "-i", inputAudioName);
    }
    if (wmImage) {
      const imgExt = wmImage.name.split(".").pop();
      args.push("-loop", "1", "-i", `wm.${imgExt}`); // loop single image
    }

    // Filtergraph for video (watermarks)
    let vfParts = ["format=yuv420p"];
    const { x, y } = posExpr("w", "h");

    const complexParts = [];
    let videoOutLabel = "[vout]";
    let prevVideoLabel = "[0:v]";

    // If text watermark
    if (wmText && wmText.trim().length > 0) {
      const opacity = Math.min(100, Math.max(0, wmTextOpacity)) / 100;
      // choose fontfile if provided
      const fontSpec = fontFile ? ":fontfile=font." + fontFile.name.split(".").pop() : "";
      complexParts.push(
        f"{prev}->drawtext=text='{wmText.replace(':','\\:').replace('"','\\"')}'{fontSpec}:fontsize={wmFontSize}:fontcolor=white@{opacity}:x={x}:y={y}[v_txt]"
        .replace("{prev}", prevVideoLabel)
      );
      prevVideoLabel = "[v_txt]";
    }

    // If image watermark
    if (wmImage) {
      const opacity = Math.min(100, Math.max(0, wmImageOpacity)) / 100;
      const scaleFactor = Math.max(1, wmImageScale) / 100.0;
      // Build overlay with opacity using colorchannelmixer
      complexParts.push(
        f"[2:v]format=rgba,scale=iw*{scaleFactor}:-1,colorchannelmixer=aa={opacity}[wm];{prevVideoLabel}[wm]overlay=x={x}:y={y}[v_wm]"
      );
      prevVideoLabel = "[v_wm]";
    }

    // ensure output label present
    complexParts.push(f"{prevVideoLabel}format=yuv420p{videoOutLabel}");

    // Audio chain
    let audioMap = null;
    let afilterParts = [];
    if (useExternalAudio) {
      audioMap = "1:a";
      const vol = Math.min(100, Math.max(0, volume)) / 100;
      afilterParts.push(f"volume={vol}");
      if (fadeIn) {
        afilterParts.push(f"afade=t=in:st=0:d={fadeDurMs/1000}");
      }
      if (fadeOut) {
        afilterParts.push(f"afade=t=out:st={duration - (fadeDurMs/1000)}:d={fadeDurMs/1000}");
      }
    } else if (!muteOriginal) {
      audioMap = "0:a";
      if (fadeIn) afilterParts.push(f"afade=t=in:st=0:d={fadeDurMs/1000}");
      if (fadeOut) afilterParts.push(f"afade=t=out:st={duration - (fadeDurMs/1000)}:d={fadeDurMs/1000}");
    }

    // -filter_complex
    args.push("-filter_complex", complexParts.join(";"));

    // map video
    args.push("-map", videoOutLabel);

    // map audio
    if (audioMap) {
      if (afilterParts.length > 0) {
        args.push("-filter:a", afilterParts.join(","));
      }
      args.push("-map", audioMap);
    } else {
      // no audio
      args.push("-an");
    }

    // encoding + duration clamp
    args.push("-t", String(duration));
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18");
    if (audioMap) {
      args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000");
    }
    args.push("-movflags", "+faststart");
    args.push("output.mp4");

    try {
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
    } catch (err) {
      console.error(err);
      alert("Processing gagal. Coba kurangi durasi atau cek pengaturan.");
    } finally {
      setProcessing(false);
    }
  }

  const disableProcess = !videoFile || (useExternalAudio && !audioFile) || processing;

  return (
    <div className="min-h-screen p-6 flex flex-col items-center">
      <div className="w-full max-w-3xl">
        <h1 className="text-2xl font-bold mb-2">🎬 ASMR Rain Video Looper (Web)</h1>
        <p className="text-gray-300 mb-6">Loop video 8 detik jadi 30–60 menit, tambah audio hujan, fade, volume, watermark teks/gambar. Siap deploy ke Vercel.</p>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-gray-800 p-4 rounded-xl space-y-3">
            <label className="block font-semibold">Video (mp4/mov)</label>
            <input type="file" accept="video/*" onChange={e=>setVideoFile(e.target.files?.[0]||null)} className="w-full" />

            <div className="flex items-center gap-2">
              <input id="mute" type="checkbox" checked={muteOriginal} onChange={e=>setMuteOriginal(e.target.checked)} />
              <label htmlFor="mute">Mute audio asli video</label>
            </div>

            <label className="block font-semibold mt-2">Durasi Target (detik)</label>
            <input type="number" min="1" value={durationSec} onChange={e=>setDurationSec(e.target.value)} className="w-full p-2 bg-gray-900 border border-gray-700 rounded" />
          </div>

          <div className="bg-gray-800 p-4 rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <input id="useAudio" type="checkbox" checked={useExternalAudio} onChange={e=>setUseExternalAudio(e.target.checked)} />
              <label htmlFor="useAudio">Pakai audio eksternal (opsional)</label>
            </div>
            <input type="file" accept="audio/*" disabled={!useExternalAudio} onChange={e=>setAudioFile(e.target.files?.[0]||null)} className="w-full" />

            <label className="block font-semibold mt-2">Volume (%)</label>
            <input type="range" min="0" max="100" value={volume} onChange={e=>setVolume(parseInt(e.target.value,10))} disabled={!useExternalAudio && muteOriginal} />
            <div className="text-sm text-gray-400">{volume}%</div>

            <div className="flex items-center gap-2 mt-2">
              <input id="fi" type="checkbox" checked={fadeIn} onChange={e=>setFadeIn(e.target.checked)} />
              <label htmlFor="fi">Fade in</label>
              <input id="fo" type="checkbox" checked={fadeOut} onChange={e=>setFadeOut(e.target.checked)} />
              <label htmlFor="fo">Fade out</label>
            </div>
            <label className="block">Durasi Fade (ms)</label>
            <input type="number" min="0" value={fadeDurMs} onChange={e=>setFadeDurMs(parseInt(e.target.value||"0",10))} className="w-full p-2 bg-gray-900 border border-gray-700 rounded" />
          </div>
        </div>

        <div className="bg-gray-800 p-4 rounded-xl space-y-3 mt-4">
          <h2 className="font-semibold text-lg">Watermark</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block">Teks (opsional)</label>
              <input type="text" value={wmText} onChange={e=>setWmText(e.target.value)} placeholder="ASMR Rain" className="w-full p-2 bg-gray-900 border border-gray-700 rounded"/>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-sm">Font size</label>
                  <input type="number" min="8" value={wmFontSize} onChange={e=>setWmFontSize(parseInt(e.target.value||"0",10))} className="w-full p-2 bg-gray-900 border border-gray-700 rounded"/>
                </div>
                <div>
                  <label className="block text-sm">Opacity (%)</label>
                  <input type="number" min="0" max="100" value={wmTextOpacity} onChange={e=>setWmTextOpacity(parseInt(e.target.value||"0",10))} className="w-full p-2 bg-gray-900 border border-gray-700 rounded"/>
                </div>
                <div>
                  <label className="block text-sm">Font (TTF)</label>
                  <input type="file" accept=".ttf,.otf" onChange={e=>setFontFile(e.target.files?.[0]||null)} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block">Gambar (opsional)</label>
              <input type="file" accept="image/*" onChange={e=>setWmImage(e.target.files?.[0]||null)} />
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-sm">Opacity (%)</label>
                  <input type="number" min="0" max="100" value={wmImageOpacity} onChange={e=>setWmImageOpacity(parseInt(e.target.value||"0",10))} className="w-full p-2 bg-gray-900 border border-gray-700 rounded"/>
                </div>
                <div>
                  <label className="block text-sm">Scale (%)</label>
                  <input type="number" min="10" max="400" value={wmImageScale} onChange={e=>setWmImageScale(parseInt(e.target.value||"0",10))} className="w-full p-2 bg-gray-900 border border-gray-700 rounded"/>
                </div>
                <div>
                  <label className="block text-sm">Posisi</label>
                  <select value={wmPosition} onChange={e=>setWmPosition(e.target.value)} className="w-full p-2 bg-gray-900 border border-gray-700 rounded">
                    <option value="top-left">Top Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="center">Center</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <button disabled={disableProcess} onClick={handleProcess} className={`mt-4 w-full p-3 rounded-xl ${disableProcess ? "bg-gray-700" : "bg-blue-600 hover:bg-blue-700"}`}>
          {processing ? "Processing..." : "Proses Video"}
        </button>

        <div className="w-full bg-gray-700 rounded-full h-4 mt-4">
          <div className="bg-blue-500 h-4 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-sm text-gray-400 mt-1">{progress}%</div>

        {downloadUrl && (
          <a className="inline-block mt-4 text-green-400 underline" href={downloadUrl} download="output.mp4">⬇️ Download output.mp4</a>
        )}

        <div className="mt-8 text-sm text-gray-400">
          <p>Tips: jika proses lama atau gagal di device low-RAM, coba kurangi durasi output atau resolusi sumber.</p>
        </div>
      </div>
    </div>
  );
}
