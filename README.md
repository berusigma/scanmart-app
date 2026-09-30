# 🛒 ScanMart — Aplikasi Scan Barcode, Cek Harga & Kasir Toko

![Capacitor Version](https://img.shields.io/badge/Capacitor-7.0.0-blue?logo=capacitor)
![Platforms](https://img.shields.io/badge/platform-Android%20%7C%20iOS%20%7C%20Windows%20%7C%20macOS-green)
![Build](https://img.shields.io/badge/build-GitHub%20Actions-2088FF?logo=github-actions)
![License](https://img.shields.io/badge/license-MIT-yellow)

**ScanMart** adalah aplikasi scan barcode kilat, cek harga barang, dan sistem Kasir (POS) offline lintas platform (**Android, iOS, Windows, dan macOS**) berbasis **Capacitor 7** & **Tauri v2** dengan **Single Codebase** dan **Otomatisasi Build Gratis via GitHub Actions**.

---

## ✨ Fitur Utama ScanMart

- ⚡ **Scan Barcode Super Cepat**: Kamera live deteksi otomatis (EAN-13, EAN-8, UPC, Code128, QR Code).
- 🔊 **SoundPool & Haptic Feedback**: Bunyi *"tit"* instan (Web Audio API zero delay) + getar singkat begitu barcode terbaca.
- 📴 **100% Offline Local Database (IndexedDB)**: Tanpa butuh koneksi internet, tanpa login akun, cepat mengolah puluhan ribu data produk dengan indeks barcode.
- 🚫 **Anti-Duplikat Barcode**: Peringatan otomatis jika kode barcode sudah pernah terdaftar di database toko.
- 🛒 **Fitur Kasir & Keranjang Belanja**: Masukkan barang ke keranjang, hitung total belanjaan, input uang tunai (*preset 10k, 20k, 50k, 100k, pas*), dan hitung **Uang Kembalian** otomatis.
- 🧾 **Cetak / Preview Struk Digital**: Menampilkan tanda bukti pembayaran yang rapi dengan nama toko dan pesan footer.
- 🏷️ **Kalkulasi Margin Otomatis**: Keuntungan langsung dihitung dari `Harga Jual - Harga Beli`.
- 📊 **CRUD & Filter Katalog**: Cari nama/barcode, filter kategori barang, edit, dan konfirmasi hapus produk.
- 💾 **Backup & Restore (JSON)**: Ekspor dan impor cadangan data produk kapan saja.
- 🌙 **Tema Dark Modern & Light Mode**: Desain futuristik biru-ungu neon + mode terang yang bersih.

---

## 📁 Struktur Direktori

```text
scanmart-app/
├── .github/
│   └── workflows/
│       └── build-all-platforms.yml   # Script GitHub Actions untuk build APK, IPA, EXE & DMG
├── android/                          # Folder native Android (Android Studio / Gradle)
├── ios/                              # Folder native iOS (Xcode)
├── src-tauri/                        # Folder native Desktop (Tauri / Rust)
├── public/                           # ⭐ SINGLE CODEBASE (Web UI & Logic)
│   ├── index.html                    # Halaman utama 15 modul & modal
│   ├── style.css                     # Design System (Dark/Light Mode & Neon UI)
│   ├── app.js                        # Engine Offline DB, Scanner, POS Kasir & Beep Sound
│   └── js/
│       └── html5-qrcode.min.js       # Library Barcode Reader Offline
├── capacitor.config.json             # App ID (com.scanmart.app) & Nama Aplikasi
├── package.json                      # NPM Dependencies & Contributor Info
└── README.md                         # Dokumentasi ini
```

---

## 🤖 GitHub Actions CI/CD Build Pipeline

Setiap kali Anda push kode ke repository GitHub ini, **GitHub Actions** akan mengompilasi aplikasi secara otomatis di cloud:

1. **Ubuntu Runner**: Mengompilasi file **Signed Release `.apk`** Android dengan keystore digital otomatis.
2. **macOS Runner**: Mengompilasi paket **`.ipa`** iOS & installer **`.dmg`** macOS.
3. **Windows Runner**: Mengompilasi installer **`.exe`** / **`.msi`** Windows.

Semua hasil build dapat langsung diunduh dari halaman tab **Actions -> Artifacts**.

---

## 📱 Cara Jalankan di Lokal

1. **Kloning Repository**:
   ```bash
   git clone https://github.com/berusigma/scanmart-app.git
   cd scanmart-app
   npm install
   ```

2. **Sinkronkan Asset Web ke Native**:
   ```bash
   node node_modules/@capacitor/cli/bin/capacitor sync
   ```

3. **Buka di Android Studio / Xcode**:
   ```bash
   node node_modules/@capacitor/cli/bin/capacitor open android
   ```

---

## 🤝 Kontributor / Authors

- **[berusigma](https://github.com/berusigma)** — Project Creator & Lead Developer
- **[Antigravity AI (@antigravity)](https://github.com/antigravity)** — AI Pair Programmer & Lead Architect

---

## 📄 Lisensi

Licensed under [MIT License](LICENSE) © 2026 berusigma & Antigravity AI.
