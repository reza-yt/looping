# ASMR Rain Looper (Web, ffmpeg.wasm)

Public web tool to loop a short video (e.g., 8s rain) into long durations (30–60 min),
optionally mute original audio, add external rain audio (looped to match), control volume,
apply audio fade in/out, and overlay a text or image watermark (position, size, opacity).
Everything runs in the browser via ffmpeg.wasm — ideal for Vercel deployment.

## Local dev
```bash
npm i
npm run dev
```

## Build / Start
```bash
npm run build
npm start
```

## Deploy to Vercel
- Push to GitHub and import repo in Vercel, or use `vercel` CLI.
- No serverless functions are required; all processing is client-side.

## Note
For text watermark, ffmpeg drawtext needs a font file. Upload a TTF/OTF in the UI if text doesn't appear.
