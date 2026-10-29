# Turkish text corpus workflow / Türkçe metin derlemi iş akışı

This optional local workflow prepares UTF-8 `.txt` and `.md` material for experiments. It does not scrape websites or include a training corpus in the repository.

Bu isteğe bağlı yerel iş akışı, deneyler için UTF-8 `.txt` ve `.md` dosyalarını hazırlar. İnternet sitelerini taramaz ve depoya eğitim derlemi eklemez.

## Before adding material / İçerik eklemeden önce

1. Put files you are allowed to use under `training/corpus/inbox/`.
2. Copy `sources.example.jsonl` to `sources.jsonl` and record one source, license and attribution entry per file.
3. Keep personal data, chat logs, copyrighted editions without a reuse grant, and unreviewed OCR out of the corpus.
4. Review the generated train/eval split before running a training experiment.

1. Kullanma iznin olan dosyaları `training/corpus/inbox/` altına koy.
2. `sources.example.jsonl` dosyasını `sources.jsonl` olarak kopyala; her dosya için kaynak, lisans ve atıf bilgisi ekle.
3. Kişisel verileri, sohbet kayıtlarını, yeniden kullanım izni olmayan telifli baskıları ve incelenmemiş OCR metinlerini derleme dışında tut.
4. Eğitim deneyi başlatmadan önce oluşturulan train/eval ayrımını incele.

The manifest and corpus files are ignored by Git because they may contain private or licensed material. The sample manifest is safe to commit. This check is a practical safeguard, not legal advice.

Manifest ve derlem dosyaları özel veya lisanslı içerik barındırabileceği için Git dışında tutulur. Örnek manifest depoya eklenebilir. Bu kontrol pratik bir önlemdir; hukuki danışmanlık değildir.

## Prepare a corpus / Derlemi hazırla

From the repository root, create a Python environment with the dependencies from `training/requirements.txt`, then run:

Depo kökünde `training/requirements.txt` bağımlılıklarıyla bir Python ortamı oluştur ve ardından çalıştır:

```powershell
Copy-Item .\training\corpus\sources.example.jsonl .\training\corpus\sources.jsonl
python .\training\corpus\prepare_corpus.py
```

The preparation script validates the manifest and writes local outputs under `training/corpus/processed/`. Those outputs remain ignored by Git.

Hazırlama betiği manifesti doğrular ve çıktıları yerel olarak `training/corpus/processed/` altına yazar. Bu çıktılar Git dışında kalır.
