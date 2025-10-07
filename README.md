# ASMR Rain Looper (Web, ffmpeg.wasm)

A public web tool to loop a short video (e.g., 8s rain) to long durations (e.g., 30–60 minutes),
optionally mute original audio, add an external rain audio (looped to match), control volume,
apply audio fade in/out, and overlay a text or image watermark with position, size and opacity.

## Stack
- Next.js (React)
- Tailwind CSS
- ffmpeg.wasm (client-side processing)

## Run locally
```bash
npm i
npm run dev
```
Open http://localhost:3000

## Build
```bash
npm run build
npm start
```

## Deploy (Vercel)
- Push to GitHub and import repository to Vercel, or
- Use Vercel CLI: `vercel`

## Note on fonts for drawtext
If text watermark doesn't render (ffmpeg `drawtext` needs a font file), add a TTF in `/public/fonts/` and select it in the UI.
Example: put `DejaVuSans.ttf` in `public/fonts/DejaVuSans.ttf`.
