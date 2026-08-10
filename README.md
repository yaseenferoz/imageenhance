# AuroraAI frontend

A standalone Vite + React frontend for the HDR/AI relighting backend.

## Run

```powershell
npm install
npm run dev
```

Set the backend in `.env.local`:

```env
VITE_API_URL=http://127.0.0.1:8000
```

The app supports standard browser images and camera RAW formats handled by the
backend, including ARW, CR2, CR3, DNG, NEF, RAF, ORF, RW2, PEF, SR2, and SRF.

The finishing studio includes Original/Enhanced preview modes, exposure,
contrast, saturation and warmth controls, click-based wall recolouring, reset,
and full-resolution JPEG export with the selected edits applied.
