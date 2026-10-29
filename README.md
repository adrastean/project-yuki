# Project Yuki

**A bilingual desktop AI agent starter built with Electron and Node.js.** Yuki keeps its chat archive and memory on the user's computer and can connect to a local Ollama model or an optional API provider.

**Electron ve Node.js ile geliştirilmiş, iki dilli masaüstü AI agent başlangıç projesi.** Yuki sohbet arşivini ve hafızasını kullanıcının bilgisayarında tutar; yerel Ollama modeline veya isteğe bağlı bir API sağlayıcısına bağlanabilir.

## Features / Özellikler

- English and Turkish interface, independent from the reply-language setting. / Yanıt dili ayarından bağımsız İngilizce ve Türkçe arayüz.
- Electron desktop window, local chat archive and memory. / Electron masaüstü penceresi, yerel sohbet arşivi ve hafıza.
- Ollama, Gemini and OpenAI-compatible provider adapters. / Ollama, Gemini ve OpenAI uyumlu sağlayıcı bağdaştırıcıları.
- Optional voice input and speech output integrations. / İsteğe bağlı sesli giriş ve konuşma üretimi bağlantıları.
- Explicit approval for desktop actions and user-selected folders. / Masaüstü işlemleri ve kullanıcının seçtiği klasörler için açık onay.
- Bilingual code comments in the main application modules. / Uygulamanın ana modüllerinde Türkçe ve İngilizce kod açıklamaları.

## Requirements / Gereksinimler

- Windows 10/11 (the desktop wrapper currently targets Windows). / Windows 10/11 (masaüstü uygulaması şu an Windows'u hedefler).
- Node.js 20 or later and npm. / Node.js 20 veya üstü ve npm.
- Optional: Ollama and a model installed locally. / İsteğe bağlı: Ollama ve bilgisayara kurulmuş bir model.

## Run from source / Kaynak koddan çalıştırma

```powershell
git clone <repository-url>
cd project-yuki
npm install
Copy-Item .env.example .env
npm start
```

The interface language selector is in the chat header. It does not change Yuki's reply language. Set that separately with the **Reply language / Yanıt dili** control.

Arayüz dili seçicisi sohbet başlığındadır. Bu ayar Yuki'nin yanıt dilini değiştirmez; yanıt dilini **Yanıt dili / Reply language** kontrolünden ayrıca seç.

## Connect a local Ollama model / Yerel Ollama modeline bağlanma

Install Ollama and pull a model, for example:

```powershell
ollama pull qwen2.5:7b
```

Set these values in the development `.env` file:

```dotenv
YUKI_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
```

Ollama'yı kurup örneğin `ollama pull qwen2.5:7b` komutuyla modeli indir. Geliştirme sırasında `.env` dosyasına yukarıdaki üç ayarı ekle.

For a packaged app, Yuki creates a private `.env` file in Electron's user-data folder on first launch. Edit that file to configure providers; the developer's `.env` is never copied into a release build.

Paketlenmiş uygulama ilk açılışta Electron'un kullanıcı verisi klasöründe özel bir `.env` oluşturur. Sağlayıcı ayarlarını bu dosyada düzenle; geliştiricinin `.env` dosyası dağıtım paketine alınmaz.

## Privacy and permissions / Gizlilik ve izinler

- `.env`, API keys, chat history, local memory, voice samples, model weights, training data, and build output are ignored by Git. / `.env`, API anahtarları, sohbet geçmişi, yerel hafıza, ses örnekleri, model ağırlıkları, eğitim verileri ve derleme çıktıları Git dışında tutulur.
- Keep `.env.example` free of real credentials. / `.env.example` içinde gerçek kimlik bilgileri bulundurma.
- Yuki only reads folders that the user selects. Desktop actions that change files require an approval flow. Review this behavior before enabling automatic approvals. / Yuki yalnızca kullanıcının seçtiği klasörleri okur. Dosyaları değiştiren masaüstü işlemleri onay akışına bağlıdır. Otomatik onayı etkinleştirmeden önce bu davranışı incele.
- The repository intentionally omits Yuki's private VRM avatar, icon and voice recording. Add only assets you created or have permission to redistribute. / Depoda Yuki'nin özel VRM avatarı, simgesi ve ses kaydı bulunmaz. Yalnızca kendin oluşturduğun veya yeniden dağıtım iznin olan varlıkları ekle.
- Interface strings are in `public/i18n.js`; persona and provider behavior are under `src/`. / Arayüz metinleri `public/i18n.js` içindedir; persona ve sağlayıcı davranışı `src/` altındadır.

## Build / Derleme

```powershell
npm run build:win
```

The build contains application code and optional integration scripts, not downloaded models or user credentials. Install the model and optional voice dependencies separately on each computer.

Derleme uygulama kodunu ve isteğe bağlı bağlantı betiklerini içerir; indirilen modelleri veya kullanıcı kimlik bilgilerini içermez. Modeli ve isteğe bağlı ses bağımlılıklarını her bilgisayara ayrıca kur.

## Repository license / Depo lisansı

The Yuki source code is licensed under the MIT License; see [`LICENSE`](LICENSE). The Inter font files are distributed under the SIL Open Font License 1.1; see [`public/assets/fonts/OFL.txt`](public/assets/fonts/OFL.txt). The Three.js and three-vrm notices are in `public/vendor/`.

Yuki kaynak kodu MIT Lisansı ile lisanslanmıştır; [`LICENSE`](LICENSE) dosyasına bak. Inter yazı tipi dosyaları SIL Open Font License 1.1 ile dağıtılır; [`public/assets/fonts/OFL.txt`](public/assets/fonts/OFL.txt) dosyası lisansı içerir. Three.js ve three-vrm lisans bildirimleri `public/vendor/` altındadır.
