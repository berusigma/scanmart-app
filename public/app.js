/**
 * ScanMart — Core Application Logic (Capacitor 7 & Fail-Safe Offline Database)
 * Features: Fast Barcode Scanning, Offline DB, Anti-Duplicate, Kasir & Belanja, Receipt, Dark/Light Mode.
 */

// ==================== 1. STATE & CONSTANTS ====================
const DB_NAME = "ScanMartDB";
const DB_VERSION = 1;
let dbInstance = null;

// Application State
let appState = {
  theme: localStorage.getItem("scanmart_theme") || "dark",
  onboarded: localStorage.getItem("scanmart_onboarded") === "true",
  storeProfile: JSON.parse(localStorage.getItem("scanmart_store") || JSON.stringify({
    name: "Toko ScanMart",
    address: "Jl. Merdeka No. 45, Telp: 08123456789",
    footer: "Terima kasih telah berbelanja!"
  })),
  currentView: "viewHome",
  cart: [], // [{ product, qty }]
  scannedBarcode: null,
  activeScanner: null,
  isScanning: false,
  targetDeleteId: null,
  duplicateProductTarget: null
};

// ==================== 2. AUDIO & HAPTIC FEEDBACK ====================
let audioCtx = null;

function playBeepSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(1800, audioCtx.currentTime); // High pitch "tit"
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  } catch (e) {
    console.log("Audio play error:", e);
  }
}

function triggerHaptic() {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([60]);
    }
  } catch (e) {}
}

// ==================== 3. DATABASE ENGINE ====================
function initDatabase() {
  return new Promise((resolve) => {
    try {
      if (!window.indexedDB) {
        console.warn("IndexedDB not supported, using LocalStorage fallback");
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("products")) {
          const productStore = db.createObjectStore("products", { keyPath: "id", autoIncrement: true });
          productStore.createIndex("barcode", "barcode", { unique: true });
          productStore.createIndex("name", "name", { unique: false });
        }
        if (!db.objectStoreNames.contains("scanHistory")) {
          db.createObjectStore("scanHistory", { keyPath: "id", autoIncrement: true });
        }
      };

      request.onsuccess = (e) => {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };

      request.onerror = (e) => {
        console.warn("IndexedDB open error:", e);
        resolve(null);
      };
    } catch (err) {
      console.warn("IndexedDB init exception:", err);
      resolve(null);
    }
  });
}

// LocalStorage Fallback Methods
function getLSProducts() {
  try {
    return JSON.parse(localStorage.getItem("scanmart_products_ls") || "[]");
  } catch (e) { return []; }
}
function setLSProducts(list) {
  try {
    localStorage.setItem("scanmart_products_ls", JSON.stringify(list));
  } catch (e) {}
}

async function dbGetAllProducts() {
  if (dbInstance) {
    return new Promise((resolve) => {
      try {
        const tx = dbInstance.transaction("products", "readonly");
        const store = tx.objectStore("products");
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve(getLSProducts());
      } catch (e) { resolve(getLSProducts()); }
    });
  }
  return getLSProducts();
}

async function dbGetProductByBarcode(barcode) {
  const products = await dbGetAllProducts();
  return products.find(p => String(p.barcode) === String(barcode)) || null;
}

async function dbSaveProduct(productData) {
  productData.updatedAt = new Date().toISOString();
  if (dbInstance) {
    return new Promise((resolve) => {
      try {
        const tx = dbInstance.transaction("products", "readwrite");
        const store = tx.objectStore("products");
        const req = productData.id ? store.put(productData) : store.add(productData);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          saveLSHelper(productData);
          resolve(true);
        };
      } catch (e) {
        saveLSHelper(productData);
        resolve(true);
      }
    });
  } else {
    saveLSHelper(productData);
    return true;
  }
}

function saveLSHelper(productData) {
  let list = getLSProducts();
  if (productData.id) {
    const idx = list.findIndex(p => p.id === productData.id);
    if (idx >= 0) list[idx] = productData;
    else list.push(productData);
  } else {
    productData.id = Date.now();
    list.push(productData);
  }
  setLSProducts(list);
}

async function dbDeleteProduct(id) {
  if (dbInstance) {
    try {
      const tx = dbInstance.transaction("products", "readwrite");
      tx.objectStore("products").delete(Number(id));
    } catch (e) {}
  }
  let list = getLSProducts().filter(p => p.id !== Number(id));
  setLSProducts(list);
  return true;
}

async function dbAddScanHistory(product) {
  const historyItem = {
    productId: product ? product.id : null,
    barcode: product ? product.barcode : appState.scannedBarcode,
    productName: product ? product.name : "Produk Tidak Ditemukan",
    price: product ? product.sellPrice : 0,
    timestamp: new Date().toISOString()
  };

  try {
    let logs = JSON.parse(localStorage.getItem("scanmart_history_log") || "[]");
    logs.unshift(historyItem);
    if (logs.length > 100) logs = logs.slice(0, 100);
    localStorage.setItem("scanmart_history_log", JSON.stringify(logs));
  } catch (e) {}

  updateRecentStats();
}

async function dbGetScanHistory() {
  try {
    return JSON.parse(localStorage.getItem("scanmart_history_log") || "[]");
  } catch (e) { return []; }
}

async function dbClearScanHistory() {
  try {
    localStorage.removeItem("scanmart_history_log");
  } catch (e) {}
  return true;
}

// Seed Sample Data (ONLY ONCE PER INSTALL, NEVER RE-SEED IF CLEARED BY USER)
async function seedSampleDataIfNeeded(force = false) {
  const isAlreadySeeded = localStorage.getItem("scanmart_seeded_done") === "true";
  
  if (isAlreadySeeded && !force) {
    return; // Don't auto-re-seed if user already cleared data or used the app!
  }

  const products = await dbGetAllProducts();
  if (products.length === 0 || force) {
    const samples = [
      { id: 1, barcode: "8999999001", name: "Indomie Goreng Spesial 85g", category: "Makanan", sellPrice: 3500, buyPrice: 3000, stock: 120, image: "" },
      { id: 2, barcode: "8992741987012", name: "Aqua Air Mineral 600ml", category: "Minuman", sellPrice: 4000, buyPrice: 3200, stock: 85, image: "" },
      { id: 3, barcode: "8998866200019", name: "Teh Botol Sosro Original 450ml", category: "Minuman", sellPrice: 6000, buyPrice: 4800, stock: 60, image: "" },
      { id: 4, barcode: "8992800101015", name: "Ultra Milk Cokelat 250ml", category: "Minuman", sellPrice: 7000, buyPrice: 5800, stock: 45, image: "" },
      { id: 5, barcode: "8992741911109", name: "Chitato Sapi Panggang 68g", category: "Makanan", sellPrice: 11500, buyPrice: 9500, stock: 30, image: "" },
      { id: 6, barcode: "8991001100223", name: "Kopi Kapal Api Mix 10x25g", category: "Minuman", sellPrice: 15000, buyPrice: 12800, stock: 50, image: "" },
      { id: 7, barcode: "8993005000018", name: "Le Minerale 600ml", category: "Minuman", sellPrice: 3500, buyPrice: 2800, stock: 90, image: "" },
      { id: 8, barcode: "8992771000125", name: "Silverqueen Milk Chocolate 58g", category: "Makanan", sellPrice: 16500, buyPrice: 13500, stock: 25, image: "" }
    ];
    for (const item of samples) {
      await dbSaveProduct(item);
    }
  }
  
  localStorage.setItem("scanmart_seeded_done", "true");
}

// ==================== 4. DOM ELEMENTS SAFE GETTER ====================
function getEl(id) {
  return document.getElementById(id);
}

// ==================== 5. NAVIGATION & VIEW CONTROLLER ====================
function switchView(viewId) {
  document.querySelectorAll(".app-view").forEach(v => v.classList.add("hidden"));
  
  const targetView = getEl(viewId);
  if (targetView) {
    targetView.classList.remove("hidden");
    appState.currentView = viewId;
  }

  document.querySelectorAll(".nav-item").forEach(item => {
    if (item.dataset.view === viewId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  if (viewId !== "viewScan" && appState.isScanning) {
    stopCameraScanner();
  } else if (viewId === "viewScan") {
    startCameraScanner();
  }

  if (viewId === "viewHome") {
    renderHomeView();
  } else if (viewId === "viewProducts") {
    renderCatalogView();
  } else if (viewId === "viewHistory") {
    renderHistoryView();
  }
}

function openModal(modalEl) {
  if (modalEl) modalEl.classList.remove("hidden");
}

function closeModal(modalEl) {
  if (modalEl) modalEl.classList.add("hidden");
}

// Universal modal close handler
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => {
    const modalId = btn.dataset.close;
    closeModal(getEl(modalId));
  });
});

// ==================== 6. THEME CONTROLLER ====================
function applyTheme(theme) {
  appState.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("scanmart_theme", theme);
}

// ==================== 7. SCANNER ENGINE ====================
function startCameraScanner() {
  if (appState.isScanning) return;
  appState.isScanning = true;

  try {
    if (!appState.activeScanner && window.Html5Qrcode) {
      appState.activeScanner = new Html5Qrcode("html5QrcodeReader");
    }

    if (appState.activeScanner) {
      const config = { fps: 15, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 };
      appState.activeScanner.start(
        { facingMode: "environment" },
        config,
        onBarcodeScannedSuccess,
        () => {}
      ).catch(err => {
        console.warn("Camera start catch:", err);
      });
    }
  } catch (e) {
    console.warn("Scanner exception:", e);
  }
}

function stopCameraScanner() {
  if (appState.activeScanner && appState.isScanning) {
    appState.activeScanner.stop().then(() => {
      appState.isScanning = false;
    }).catch(() => {
      appState.isScanning = false;
    });
  } else {
    appState.isScanning = false;
  }
}

async function onBarcodeScannedSuccess(decodedText) {
  playBeepSound();
  triggerHaptic();
  
  appState.scannedBarcode = decodedText;
  stopCameraScanner();
  
  const product = await dbGetProductByBarcode(decodedText);
  await dbAddScanHistory(product);
  
  if (product) {
    showProductDetailModal(product);
  } else {
    const notFoundText = getEl("notFoundBarcodeText");
    if (notFoundText) notFoundText.textContent = decodedText;
    openModal(getEl("modalNotFound"));
  }
}

// ==================== 8. PRODUCT DETAIL MODAL ====================
function showProductDetailModal(product) {
  getEl("detailCategoryBadge").textContent = product.category || "Umum";
  getEl("detailProductName").textContent = product.name;
  getEl("detailBarcodeText").textContent = product.barcode;
  getEl("detailSellPrice").textContent = formatRupiah(product.sellPrice);
  getEl("detailBuyPrice").textContent = formatRupiah(product.buyPrice || 0);
  
  const margin = (product.sellPrice || 0) - (product.buyPrice || 0);
  getEl("detailMargin").textContent = formatRupiah(margin);
  getEl("detailStock").textContent = `${product.stock || 0} pcs`;

  const imgEl = getEl("detailProductImage");
  const placeholderEl = getEl("detailImagePlaceholder");
  if (product.image) {
    imgEl.src = product.image;
    imgEl.classList.remove("hidden");
    placeholderEl.classList.add("hidden");
  } else {
    imgEl.classList.add("hidden");
    placeholderEl.classList.remove("hidden");
  }

  getEl("btnAddCartFromDetail").onclick = () => {
    addToCart(product);
    closeModal(getEl("modalProductDetail"));
    openModal(getEl("modalCashierCart"));
  };

  getEl("btnEditFromDetail").onclick = () => {
    closeModal(getEl("modalProductDetail"));
    openProductForm(product);
  };

  getEl("btnScanAgainFromDetail").onclick = () => {
    closeModal(getEl("modalProductDetail"));
    switchView("viewScan");
  };

  openModal(getEl("modalProductDetail"));
}

// ==================== 9. PRODUCT CRUD & FORM ====================
function openProductForm(product = null) {
  const form = getEl("productForm");
  if (form) form.reset();
  
  getEl("formMarginPreview").textContent = "Rp 0";
  getEl("formImagePreview").classList.add("hidden");
  getEl("formImagePlaceholder").classList.remove("hidden");
  getEl("formImageData").value = "";

  if (product && product.id) {
    getEl("formTitle").textContent = "Edit Produk";
    getEl("formProductId").value = product.id;
    getEl("formBarcode").value = product.barcode || "";
    getEl("formName").value = product.name || "";
    getEl("formCategory").value = product.category || "Makanan";
    getEl("formSellPrice").value = product.sellPrice || "";
    getEl("formBuyPrice").value = product.buyPrice || "";
    getEl("formStock").value = product.stock || 0;
    
    if (product.image) {
      getEl("formImagePreview").src = product.image;
      getEl("formImagePreview").classList.remove("hidden");
      getEl("formImagePlaceholder").classList.add("hidden");
      getEl("formImageData").value = product.image;
    }

    getEl("btnDeleteProductFromForm").classList.remove("hidden");
    updateMarginCalculation();
  } else {
    getEl("formTitle").textContent = "Tambah Produk Baru";
    getEl("formProductId").value = "";
    if (product && product.barcode) {
      getEl("formBarcode").value = product.barcode;
    }
    getEl("btnDeleteProductFromForm").classList.add("hidden");
  }

  openModal(getEl("modalProductForm"));
}

function updateMarginCalculation() {
  const sell = Number(getEl("formSellPrice").value) || 0;
  const buy = Number(getEl("formBuyPrice").value) || 0;
  getEl("formMarginPreview").textContent = formatRupiah(sell - buy);
}

// ==================== 10. KASIR & KERANJANG BELANJA ====================
function addToCart(product) {
  const foundIndex = appState.cart.findIndex(item => item.product.id === product.id);
  if (foundIndex >= 0) {
    appState.cart[foundIndex].qty += 1;
  } else {
    appState.cart.push({ product, qty: 1 });
  }
  updateCartUI();
  playBeepSound();
}

function updateCartUI() {
  const totalCount = appState.cart.reduce((sum, item) => sum + item.qty, 0);
  getEl("cartBadgeCount").textContent = totalCount;

  const container = getEl("cartItemsContainer");
  container.innerHTML = "";
  let grandTotal = 0;

  if (appState.cart.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 0; color: var(--text-muted);">
        <i class="fa-solid fa-cart-flatbed" style="font-size: 48px; margin-bottom: 12px;"></i>
        <p>Keranjang belanja masih kosong.</p>
      </div>
    `;
  } else {
    appState.cart.forEach((item, index) => {
      const subtotal = item.product.sellPrice * item.qty;
      grandTotal += subtotal;

      const card = document.createElement("div");
      card.className = "cart-item-card";
      card.innerHTML = `
        <div class="cart-item-info">
          <h5>${escapeHtml(item.product.name)}</h5>
          <div class="cart-item-price">${formatRupiah(item.product.sellPrice)} x ${item.qty} = <strong>${formatRupiah(subtotal)}</strong></div>
        </div>
        <div class="qty-controls">
          <button class="btn-qty" onclick="changeCartQty(${index}, -1)">-</button>
          <span class="qty-num">${item.qty}</span>
          <button class="btn-qty" onclick="changeCartQty(${index}, 1)">+</button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  getEl("cartTotalDisplay").textContent = formatRupiah(grandTotal);
  calculateChangeDue();
}

function changeCartQty(index, delta) {
  if (appState.cart[index]) {
    appState.cart[index].qty += delta;
    if (appState.cart[index].qty <= 0) {
      appState.cart.splice(index, 1);
    }
    updateCartUI();
  }
}

function calculateChangeDue() {
  const grandTotal = appState.cart.reduce((sum, item) => sum + (item.product.sellPrice * item.qty), 0);
  const cash = Number(getEl("inputCashReceived").value) || 0;
  const change = cash - grandTotal;

  const changeCard = getEl("cartChangeDisplay");
  if (cash >= grandTotal && grandTotal > 0) {
    changeCard.textContent = formatRupiah(change);
    changeCard.className = "change-amount text-neon-green";
  } else if (cash < grandTotal && cash > 0) {
    changeCard.textContent = `Kurang ${formatRupiah(Math.abs(change))}`;
    changeCard.className = "change-amount text-danger";
  } else {
    changeCard.textContent = "Rp 0";
    changeCard.className = "change-amount";
  }
}

// ==================== 11. HOME & CATALOG RENDERERS ====================
async function updateRecentStats() {
  const products = await dbGetAllProducts();
  const scans = await dbGetScanHistory();
  
  if (getEl("statTotalProducts")) getEl("statTotalProducts").textContent = products.length;
  if (getEl("statTotalScans")) getEl("statTotalScans").textContent = scans.length;
}

async function renderHomeView() {
  updateRecentStats();
  if (getEl("homeStoreName")) getEl("homeStoreName").textContent = appState.storeProfile.name;
  
  const products = await dbGetAllProducts();
  const recent = products.slice(-5).reverse();

  const container = getEl("homeRecentProducts");
  if (!container) return;

  container.innerHTML = "";
  if (recent.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted);">
        Belum ada produk terdaftar. Klik 'Tambah Produk' untuk menginput barang.
      </div>
    `;
  } else {
    recent.forEach(p => {
      container.appendChild(createProductItemCard(p));
    });
  }
}

async function renderCatalogView() {
  const products = await dbGetAllProducts();
  const searchInput = getEl("catalogSearchInput");
  const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
  const activeCat = document.querySelector(".pill-btn.active")?.dataset.cat || "all";
  const sortBy = getEl("catalogSortSelect")?.value || "newest";

  let filtered = products.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(query) || p.barcode.toLowerCase().includes(query);
    const matchCat = activeCat === "all" || p.category === activeCat;
    return matchQuery && matchCat;
  });

  filtered.sort((a, b) => {
    if (sortBy === "name_asc") return a.name.localeCompare(b.name);
    if (sortBy === "price_asc") return a.sellPrice - b.sellPrice;
    if (sortBy === "price_desc") return b.sellPrice - a.sellPrice;
    if (sortBy === "stock_asc") return a.stock - b.stock;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });

  if (getEl("catalogCountText")) getEl("catalogCountText").textContent = `Menampilkan ${filtered.length} dari ${products.length} produk`;
  const container = getEl("catalogProductList");
  if (!container) return;

  container.innerHTML = "";
  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 0; color: var(--text-muted);">
        <i class="fa-solid fa-box-open" style="font-size: 48px; margin-bottom: 12px;"></i>
        <p>Tidak ada produk yang cocok dengan pencarian.</p>
      </div>
    `;
  } else {
    filtered.forEach(p => {
      container.appendChild(createProductItemCard(p));
    });
  }
}

function createProductItemCard(product) {
  const card = document.createElement("div");
  card.className = "product-item-card";
  card.onclick = () => showProductDetailModal(product);

  const imgHTML = product.image 
    ? `<img src="${product.image}" class="product-thumb" />`
    : `<div class="product-thumb"><i class="fa-solid fa-box"></i></div>`;

  card.innerHTML = `
    ${imgHTML}
    <div class="product-details">
      <div class="product-name">${escapeHtml(product.name)}</div>
      <div class="product-meta">
        <span><i class="fa-solid fa-barcode"></i> ${product.barcode}</span>
        <span>${product.category || "Umum"}</span>
      </div>
    </div>
    <div class="product-price-box">
      <div class="product-price">${formatRupiah(product.sellPrice)}</div>
      <div class="product-stock">Stok: ${product.stock || 0} pcs</div>
    </div>
  `;
  return card;
}

// ==================== 12. HISTORY RENDERER ====================
async function renderHistoryView() {
  const history = await dbGetScanHistory();
  const container = getEl("scanHistoryList");
  if (!container) return;

  container.innerHTML = "";

  if (history.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 0; color: var(--text-muted);">
        <i class="fa-solid fa-clock-rotate-left" style="font-size: 48px; margin-bottom: 12px;"></i>
        <p>Belum ada riwayat scan barcode.</p>
      </div>
    `;
  } else {
    history.forEach(item => {
      const card = document.createElement("div");
      card.className = "history-card";
      card.innerHTML = `
        <div>
          <strong>${escapeHtml(item.productName)}</strong>
          <div class="product-meta">
            <span>Barcode: ${item.barcode}</span>
          </div>
          <div class="history-time"><i class="fa-regular fa-clock"></i> ${formatDateTime(new Date(item.timestamp))}</div>
        </div>
        <div style="font-size: 15px; font-weight: 800; color: var(--neon-cyan);">
          ${item.price ? formatRupiah(item.price) : "-"}
        </div>
      `;
      container.appendChild(card);
    });
  }
}

// ==================== 13. HELPER UTILITIES ====================
function formatRupiah(number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(number || 0);
}

function formatDateTime(dateObj) {
  return dateObj.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[m]);
}

// ==================== 14. EVENT LISTENERS BINDING ====================
function bindEventListeners() {
  // Theme Toggle
  if (getEl("btnThemeToggle")) {
    getEl("btnThemeToggle").addEventListener("click", () => {
      const newTheme = appState.theme === "dark" ? "light" : "dark";
      applyTheme(newTheme);
    });
  }

  // Flashlight & Gallery
  if (getEl("btnToggleFlash")) {
    getEl("btnToggleFlash").addEventListener("click", () => {
      if (appState.activeScanner && appState.isScanning) {
        appState.activeScanner.applyVideoConstraints({ advanced: [{ torch: true }] }).catch(() => {
          alert("Senter tidak didukung pada perangkat ini.");
        });
      }
    });
  }

  if (getEl("btnGalleryScan")) {
    getEl("btnGalleryScan").addEventListener("click", () => getEl("fileInputGallery")?.click());
  }

  if (getEl("fileInputGallery")) {
    getEl("fileInputGallery").addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const html5QrCode = new Html5Qrcode("html5QrcodeReader");
        html5QrCode.scanFile(file, true).then(onBarcodeScannedSuccess).catch(() => {
          alert("Gagal membaca barcode dari gambar.");
        });
      }
    });
  }

  if (getEl("btnOpenManualScan")) {
    getEl("btnOpenManualScan").addEventListener("click", () => openModal(getEl("modalManualInput")));
  }

  if (getEl("btnSubmitManualScan")) {
    getEl("btnSubmitManualScan").addEventListener("click", () => {
      const code = getEl("manualBarcodeCode")?.value.trim();
      if (code) {
        closeModal(getEl("modalManualInput"));
        if (getEl("manualBarcodeCode")) getEl("manualBarcodeCode").value = "";
        onBarcodeScannedSuccess(code);
      }
    });
  }

  if (getEl("btnCreateWithBarcode")) {
    getEl("btnCreateWithBarcode").addEventListener("click", () => {
      closeModal(getEl("modalNotFound"));
      openProductForm({ barcode: appState.scannedBarcode });
    });
  }

  // Image Picker
  if (getEl("btnTriggerImagePicker")) {
    getEl("btnTriggerImagePicker").addEventListener("click", () => getEl("formFileInput")?.click());
  }
  if (getEl("formFileInput")) {
    getEl("formFileInput").addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (evt) => {
          getEl("formImagePreview").src = evt.target.result;
          getEl("formImagePreview").classList.remove("hidden");
          getEl("formImagePlaceholder").classList.add("hidden");
          getEl("formImageData").value = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (getEl("formSellPrice")) getEl("formSellPrice").addEventListener("input", updateMarginCalculation);
  if (getEl("formBuyPrice")) getEl("formBuyPrice").addEventListener("input", updateMarginCalculation);

  // Form Submission
  const pForm = getEl("productForm");
  if (pForm) {
    pForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = getEl("formProductId").value ? Number(getEl("formProductId").value) : null;
      const barcode = getEl("formBarcode").value.trim();
      const name = getEl("formName").value.trim();
      const category = getEl("formCategory").value;
      const sellPrice = Number(getEl("formSellPrice").value);
      const buyPrice = Number(getEl("formBuyPrice").value) || 0;
      const stock = Number(getEl("formStock").value) || 0;
      const image = getEl("formImageData").value;

      if (!barcode || !name || isNaN(sellPrice)) {
        alert("Mohon lengkapi data barcode, nama, dan harga jual!");
        return;
      }

      const existing = await dbGetProductByBarcode(barcode);
      if (existing && existing.id !== id) {
        appState.duplicateProductTarget = existing;
        if (getEl("duplicateBarcodeNum")) getEl("duplicateBarcodeNum").textContent = barcode;
        if (getEl("duplicateProductName")) getEl("duplicateProductName").textContent = existing.name;
        openModal(getEl("modalDuplicateBarcode"));
        return;
      }

      await dbSaveProduct({ id: id || undefined, barcode, name, category, sellPrice, buyPrice, stock, image });
      closeModal(getEl("modalProductForm"));
      renderHomeView();
      renderCatalogView();
    });
  }

  if (getEl("btnViewDuplicateProduct")) {
    getEl("btnViewDuplicateProduct").addEventListener("click", () => {
      closeModal(getEl("modalDuplicateBarcode"));
      closeModal(getEl("modalProductForm"));
      if (appState.duplicateProductTarget) showProductDetailModal(appState.duplicateProductTarget);
    });
  }

  if (getEl("btnDeleteProductFromForm")) {
    getEl("btnDeleteProductFromForm").addEventListener("click", () => {
      appState.targetDeleteId = Number(getEl("formProductId").value);
      if (getEl("deleteTargetName")) getEl("deleteTargetName").textContent = getEl("formName").value;
      openModal(getEl("modalConfirmDelete"));
    });
  }

  if (getEl("btnConfirmDeleteExecution")) {
    getEl("btnConfirmDeleteExecution").addEventListener("click", async () => {
      if (appState.targetDeleteId) {
        await dbDeleteProduct(appState.targetDeleteId);
        closeModal(getEl("modalConfirmDelete"));
        closeModal(getEl("modalProductForm"));
        renderHomeView();
        renderCatalogView();
      }
    });
  }

  if (getEl("btnScanForForm")) {
    getEl("btnScanForForm").addEventListener("click", () => {
      closeModal(getEl("modalProductForm"));
      switchView("viewScan");
    });
  }

  // Cart & Cashier Controls
  if (getEl("btnClearCartItems")) {
    getEl("btnClearCartItems").addEventListener("click", () => {
      if (confirm("Kosongkan seluruh keranjang belanja?")) {
        appState.cart = [];
        updateCartUI();
      }
    });
  }

  if (getEl("inputCashReceived")) {
    getEl("inputCashReceived").addEventListener("input", calculateChangeDue);
  }

  document.querySelectorAll(".btn-cash-tag").forEach(btn => {
    btn.addEventListener("click", () => {
      const grandTotal = appState.cart.reduce((sum, item) => sum + (item.product.sellPrice * item.qty), 0);
      if (btn.id === "btnCashExact") {
        getEl("inputCashReceived").value = grandTotal;
      } else {
        getEl("inputCashReceived").value = btn.dataset.val;
      }
      calculateChangeDue();
    });
  });

  if (getEl("btnFinishTransaction")) {
    getEl("btnFinishTransaction").addEventListener("click", async () => {
      const grandTotal = appState.cart.reduce((sum, item) => sum + (item.product.sellPrice * item.qty), 0);
      const cash = Number(getEl("inputCashReceived").value) || 0;

      if (appState.cart.length === 0) { alert("Keranjang masih kosong!"); return; }
      if (cash < grandTotal) { alert("Uang pembeli kurang dari total!"); return; }

      for (const item of appState.cart) {
        if (item.product.id) {
          const current = await dbGetProductByBarcode(item.product.barcode);
          if (current) {
            current.stock = Math.max(0, (current.stock || 0) - item.qty);
            await dbSaveProduct(current);
          }
        }
      }

      if (getEl("receiptStoreName")) getEl("receiptStoreName").textContent = appState.storeProfile.name;
      if (getEl("receiptStoreAddress")) getEl("receiptStoreAddress").textContent = appState.storeProfile.address;
      if (getEl("receiptFooterText")) getEl("receiptFooterText").textContent = appState.storeProfile.footer;
      if (getEl("receiptDate")) getEl("receiptDate").textContent = formatDateTime(new Date());

      const itemsContainer = getEl("receiptItemsList");
      if (itemsContainer) {
        itemsContainer.innerHTML = "";
        appState.cart.forEach(item => {
          const row = document.createElement("div");
          row.className = "receipt-row";
          row.innerHTML = `<span>${escapeHtml(item.product.name)} (${item.qty}x)</span><span>${formatRupiah(item.product.sellPrice * item.qty)}</span>`;
          itemsContainer.appendChild(row);
        });
      }

      if (getEl("receiptTotal")) getEl("receiptTotal").textContent = formatRupiah(grandTotal);
      if (getEl("receiptCash")) getEl("receiptCash").textContent = formatRupiah(cash);
      if (getEl("receiptChange")) getEl("receiptChange").textContent = formatRupiah(cash - grandTotal);

      closeModal(getEl("modalCashierCart"));
      openModal(getEl("modalReceipt"));

      appState.cart = [];
      if (getEl("inputCashReceived")) getEl("inputCashReceived").value = "";
      updateCartUI();
      renderHomeView();
    });
  }

  if (getEl("btnCloseReceipt")) {
    getEl("btnCloseReceipt").addEventListener("click", () => closeModal(getEl("modalReceipt")));
  }
  if (getEl("btnCashierScanItem")) {
    getEl("btnCashierScanItem").addEventListener("click", () => {
      closeModal(getEl("modalCashierCart"));
      switchView("viewScan");
    });
  }
  if (getEl("btnHeaderCart")) {
    getEl("btnHeaderCart").addEventListener("click", () => openModal(getEl("modalCashierCart")));
  }

  // Home Quick Search
  const homeSearch = getEl("homeSearchInput");
  if (homeSearch) {
    homeSearch.addEventListener("input", async (e) => {
      const query = e.target.value.toLowerCase().trim();
      const resultsContainer = getEl("homeSearchResults");
      const clearBtn = getEl("btnClearHomeSearch");

      if (!query) {
        if (resultsContainer) resultsContainer.classList.add("hidden");
        if (clearBtn) clearBtn.classList.add("hidden");
        return;
      }

      if (clearBtn) clearBtn.classList.remove("hidden");
      const products = await dbGetAllProducts();
      const results = products.filter(p => p.name.toLowerCase().includes(query) || p.barcode.toLowerCase().includes(query)).slice(0, 5);

      if (resultsContainer) {
        resultsContainer.innerHTML = "";
        if (results.length === 0) {
          resultsContainer.innerHTML = `<div class="dropdown-item"><span>Tidak ditemukan</span></div>`;
        } else {
          results.forEach(p => {
            const item = document.createElement("div");
            item.className = "dropdown-item";
            item.innerHTML = `<div><strong>${escapeHtml(p.name)}</strong><div style="font-size:11px;color:var(--text-muted);">${p.barcode}</div></div><div style="font-weight:700;color:var(--neon-green);">${formatRupiah(p.sellPrice)}</div>`;
            item.onclick = () => {
              resultsContainer.classList.add("hidden");
              showProductDetailModal(p);
            };
            resultsContainer.appendChild(item);
          });
        }
        resultsContainer.classList.remove("hidden");
      }
    });
  }

  if (getEl("btnClearHomeSearch")) {
    getEl("btnClearHomeSearch").addEventListener("click", () => {
      if (getEl("homeSearchInput")) getEl("homeSearchInput").value = "";
      if (getEl("homeSearchResults")) getEl("homeSearchResults").classList.add("hidden");
      getEl("btnClearHomeSearch").classList.add("hidden");
    });
  }

  if (getEl("btnClearScanHistory")) {
    getEl("btnClearScanHistory").addEventListener("click", async () => {
      if (confirm("Hapus seluruh riwayat scan barcode?")) {
        await dbClearScanHistory();
        renderHistoryView();
        updateRecentStats();
      }
    });
  }

  if (getEl("btnSaveStoreProfile")) {
    getEl("btnSaveStoreProfile").addEventListener("click", () => {
      appState.storeProfile.name = getEl("settingStoreName")?.value.trim() || "Toko ScanMart";
      appState.storeProfile.address = getEl("settingStoreAddress")?.value.trim() || "";
      appState.storeProfile.footer = getEl("settingReceiptFooter")?.value.trim() || "";
      localStorage.setItem("scanmart_store", JSON.stringify(appState.storeProfile));
      alert("Profil toko disimpan!");
      renderHomeView();
    });
  }

  if (getEl("btnExportData")) {
    getEl("btnExportData").addEventListener("click", async () => {
      const products = await dbGetAllProducts();
      const backupData = { app: "ScanMart", version: "1.0.0", exportDate: new Date().toISOString(), products };
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
      const a = document.createElement("a");
      a.href = dataStr;
      a.download = `ScanMart_Backup.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  if (getEl("btnRestoreData")) {
    getEl("btnRestoreData").addEventListener("click", () => getEl("fileInputRestore")?.click());
  }

  if (getEl("fileInputRestore")) {
    getEl("fileInputRestore").addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const parsed = JSON.parse(evt.target.result);
            if (parsed && Array.isArray(parsed.products)) {
              for (const item of parsed.products) {
                delete item.id;
                await dbSaveProduct(item);
              }
              localStorage.setItem("scanmart_seeded_done", "true");
              alert(`Berhasil mengimpor ${parsed.products.length} produk!`);
              renderHomeView();
              renderCatalogView();
            }
          } catch (err) { alert("File JSON tidak valid."); }
        };
        reader.readAsText(file);
      }
    });
  }

  if (getEl("btnSeedSampleData")) {
    getEl("btnSeedSampleData").addEventListener("click", async () => {
      await seedSampleDataIfNeeded(true); // force seed!
      alert("Sampel data minimarket berhasil dimasukkan!");
      renderHomeView();
      renderCatalogView();
    });
  }

  if (getEl("btnResetAllData")) {
    getEl("btnResetAllData").addEventListener("click", async () => {
      if (confirm("APAKAH ANDA YAKIN? Seluruh produk dan riwayat akan dihapus permanen!")) {
        const products = await dbGetAllProducts();
        for (const p of products) await dbDeleteProduct(p.id);
        await dbClearScanHistory();
        localStorage.setItem("scanmart_products_ls", "[]"); // Clear LS backup too!
        localStorage.setItem("scanmart_seeded_done", "true"); // Prevent auto re-seeding!
        alert("Database berhasil dikosongkan.");
        renderHomeView();
        renderCatalogView();
      }
    });
  }

  if (getEl("categoryFilterPills")) {
    getEl("categoryFilterPills").addEventListener("click", (e) => {
      if (e.target.classList.contains("pill-btn")) {
        document.querySelectorAll(".pill-btn").forEach(p => p.classList.remove("active"));
        e.target.classList.add("active");
        renderCatalogView();
      }
    });
  }

  if (getEl("catalogSearchInput")) getEl("catalogSearchInput").addEventListener("input", renderCatalogView);
  if (getEl("catalogSortSelect")) getEl("catalogSortSelect").addEventListener("change", renderCatalogView);

  // Menu Cards
  if (getEl("menuCardScan")) getEl("menuCardScan").onclick = () => switchView("viewScan");
  if (getEl("menuCardCashier")) getEl("menuCardCashier").onclick = () => openModal(getEl("modalCashierCart"));
  if (getEl("menuCardAdd")) getEl("menuCardAdd").onclick = () => openProductForm();
  if (getEl("menuCardList")) getEl("menuCardList").onclick = () => switchView("viewProducts");

  if (getEl("btnNavScan")) getEl("btnNavScan").onclick = () => switchView("viewScan");
  if (getEl("btnFabAddProduct")) getEl("btnFabAddProduct").onclick = () => openProductForm();
  if (getEl("btnSeeAllProducts")) getEl("btnSeeAllProducts").onclick = () => switchView("viewProducts");
  if (getEl("btnBackFromScan")) getEl("btnBackFromScan").onclick = () => switchView("viewHome");

  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => switchView(item.dataset.view));
  });

  if (getEl("btnNextOnboarding")) {
    getEl("btnNextOnboarding").addEventListener("click", () => {
      const slides = document.querySelectorAll(".onboarding-slide");
      const dots = document.querySelectorAll(".dot");
      let activeIndex = 0;
      slides.forEach((s, idx) => { if (s.classList.contains("active")) activeIndex = idx; });
      if (activeIndex < slides.length - 1) {
        slides[activeIndex].classList.remove("active");
        dots[activeIndex].classList.remove("active");
        slides[activeIndex + 1].classList.add("active");
        dots[activeIndex + 1].classList.add("active");
      } else {
        completeOnboarding();
      }
    });
  }

  if (getEl("btnSkipOnboarding")) getEl("btnSkipOnboarding").addEventListener("click", completeOnboarding);
}

function completeOnboarding() {
  localStorage.setItem("scanmart_onboarded", "true");
  if (getEl("onboardingScreen")) getEl("onboardingScreen").classList.add("hidden");
  if (getEl("appShell")) getEl("appShell").classList.remove("hidden");
  switchView("viewHome");
}

// ==================== 15. FAIL-SAFE INITIALIZATION BOOTSTRAP ====================
let isAppInitialized = false;

function dismissSplashScreen() {
  const splash = getEl("splashScreen");
  const shell = getEl("appShell");
  const onboarding = getEl("onboardingScreen");

  if (splash) splash.classList.add("hidden");

  const onboarded = localStorage.getItem("scanmart_onboarded") === "true";
  if (!onboarded && onboarding) {
    onboarding.classList.remove("hidden");
  } else if (shell) {
    shell.classList.remove("hidden");
  }
}

async function initApp() {
  if (isAppInitialized) return;
  isAppInitialized = true;

  applyTheme(appState.theme);
  bindEventListeners();

  // Load Settings
  if (getEl("settingStoreName")) getEl("settingStoreName").value = appState.storeProfile.name;
  if (getEl("settingStoreAddress")) getEl("settingStoreAddress").value = appState.storeProfile.address || "";
  if (getEl("settingReceiptFooter")) getEl("settingReceiptFooter").value = appState.storeProfile.footer || "";

  // Guaranteed Fail-Safe Timer: Dismiss Splash Screen after 1.2s max
  setTimeout(() => {
    dismissSplashScreen();
    switchView("viewHome");
  }, 1200);

  // Initialize DB asynchronously without blocking UI transition
  try {
    await initDatabase();
    await seedSampleDataIfNeeded();
    renderHomeView();
  } catch (err) {
    console.warn("DB init background exception:", err);
  }
}

// Robust bootstrap caller
if (document.readyState === "complete" || document.readyState === "interactive") {
  initApp();
} else {
  document.addEventListener("DOMContentLoaded", initApp);
  setTimeout(initApp, 800);
}
