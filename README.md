# Voyager Translation Tool

AI-powered translation tool for Laravel Voyager. Upload your SQL dump, auto-translate content using Google Translate or Gemini AI, and export ready-to-use SQL files.

## Features

- **Auto language detection** — Detects source language from both the `translations` table and model tables (e.g. Turkish content stored directly in `products`, `posts` etc.)
- **Dynamic target languages** — Add/remove any of 14 supported languages
- **Dual engine** — Google Translate (GTX, free) or Gemini AI (requires API key)
- **HTML-safe translation** — Protects HTML tags and placeholders using RTL-safe tokens
- **Slug handling** — Transliterates Cyrillic, Turkish, and Arabic characters into valid URL slugs
- **Gemini API key manager** — Test & save your key directly from the UI (stored in localStorage)

## Supported Languages

Turkish · English · Spanish · Russian · German · French · Arabic · Chinese · Portuguese · Italian · Japanese · Korean · Dutch · Polish · Ukrainian

## Run Locally

**Prerequisites:** Node.js

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Gemini AI Setup (optional)

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Either paste it into the **Gemini API Key** panel in the UI, or add it to `.env.local`:

```
GEMINI_API_KEY=your_key_here
```

If no key is provided, the app falls back to Google Translate (GTX) automatically.

## How It Works

1. Upload your full Laravel Voyager SQL dump
2. The app parses the `translations` table and all model tables
3. Source language is auto-detected (e.g. Turkish content in model tables)
4. Select target languages to translate into
5. Click **Start Translation** — batches are processed with rate limiting
6. Export the generated SQL and run it on your database
