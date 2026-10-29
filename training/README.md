# Experimental model training / Deneysel model eğitimi

This folder contains optional, experimental scripts for preparing a small Turkish adaptation. It is not required to run the desktop app and is not part of Yuki's default inference path.

Bu klasör, küçük bir Türkçe uyarlama hazırlamak için isteğe bağlı ve deneysel betikler içerir. Masaüstü uygulamasını çalıştırmak için gerekmez ve Yuki'nin varsayılan model yolunda kullanılmaz.

## Data and privacy / Veri ve gizlilik

- Use only material you created, material in the public domain, or data whose license explicitly allows this use. Record sources and attribution. / Yalnızca kendin oluşturduğun, kamu malı veya lisansı bu kullanıma açıkça izin veren içerikleri kullan. Kaynakları ve atıfları kaydet.
- Do not train on chat history, personal memory, API responses, or unreviewed documents. / Sohbet geçmişi, kişisel hafıza, API yanıtları veya incelenmemiş belgelerle eğitim yapma.
- Datasets, model downloads, checkpoints and adapters are ignored by Git. Never add them to a public commit unless you have verified the redistribution rights. / Veri kümeleri, model indirmeleri, checkpoint'ler ve adapter'lar Git dışında tutulur. Yeniden dağıtım haklarını doğrulamadan bunları herkese açık commit'e ekleme.

See [`corpus/README.md`](corpus/README.md) for the source-manifest workflow. Training scripts are experimental and can reduce general instruction-following quality; evaluate on a held-out set before using an adapter.

Kaynak manifesti iş akışı için [`corpus/README.md`](corpus/README.md) dosyasına bak. Eğitim betikleri deneyseldir ve genel talimat izleme kalitesini düşürebilir; adapter'ı kullanmadan önce ayrı bir değerlendirme kümesinde incele.
