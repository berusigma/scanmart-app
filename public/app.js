/**
 * ScanMart — Core Application Logic (Capacitor 7 & Offline Database)
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

// ==================== 2. AUDIO & HAPTIC FEEDBACK (SOUNDPOOL SIMULATION) ====================
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
  if (navigator.vibrate) {
    navigator.vibrate([60]);
  }
}

// ==================== 3. DATABASE ENGINE (INDEXEDDB) ====================
function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      
      // Products Store (Index: barcode)
      if (!db.objectStoreNames.contains("products")) {
        const productStore = db.createObjectStore("products", { keyPath: "id", autoIncrement: true });
        productStore.createIndex("barcode", "barcode", { unique: true });
        productStore.createIndex("name", "name", { unique: false });
        productStore.createIndex("category", "category", { unique: false });
      }

      // History Store
      if (!db.objectStoreNames.contains("scanHistory")) {
        const historyStore = db.createObjectStore("scanHistory", { keyPath: "id", autoIncrement: true });
        historyStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => {
      console.error("IndexedDB error:", e);
      reject(e);
    };
  });
}

// DB Helper Methods
async function dbGetAllProducts() {
  return new Promise((resolve) => {
    const tx = dbInstance.transaction("products", "readonly");
    const store = tx.objectStore("products");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

async function dbGetProductByBarcode(barcode) {
  return new Promise((resolve) => {
    const tx = dbInstance.transaction("products", "readonly");
    const store = tx.objectStore("products");
    const index = store.index("barcode");
    const req = index.get(barcode);
    req.onsuccess = () => resolve(req.result || null);
  });
}

async function dbSaveProduct(productData) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction("products", "readwrite");
    const store = tx.objectStore("products");
    
    productData.updatedAt = new Date().toISOString();
    const req = productData.id ? store.put(productData) : store.add(productData);

    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

async function dbDeleteProduct(id) {
  return new Promise((resolve) => {
    const tx = dbInstance.transaction("products", "readwrite");
    const store = tx.objectStore("products");
    const req = store.delete(Number(id));
    req.onsuccess = () => resolve(true);
  });
}

async function dbAddScanHistory(product) {
  return new Promise((resolve) => {
    const tx = dbInstance.transaction("scanHistory", "readwrite");
    const store = tx.objectStore("scanHistory");
    store.add({
      productId: product ? product.id : null,
      barcode: product ? product.barcode : appState.scannedBarcode,
      productName: product ? product.name : "Produk Tidak Ditemukan",
      price: product ? product.sellPrice : 0,
      timestamp: new Date().toISOString()
    });
    tx.oncomplete = () => {
      updateRecentStats();
      resolve(true);
    };
  });
}

async function dbGetScanHistory() {
  return new Promise((resolve) => {
    const tx = dbInstance.transaction("scanHistory", "readonly");
    const store = tx.objectStore("scanHistory");
    const req = store.getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      resolve(list);
    };
  });
}

async function dbClearScanHistory() {
  return new Promise((resolve) => {
    const tx = dbInstance.transaction("scanHistory", "readwrite");
    const store = tx.objectStore("scanHistory");
    store.clear();
    tx.oncomplete = () => resolve(true);
  });
}

// Seed Initial Sample Data (Indonesian Groceries)
async function seedSampleDataIfNeeded() {
  const products = await dbGetAllProducts();
  if (products.length === 0) {
    const samples = [
      { barcode: "8999999001", name: "Indomie Goreng Spesial 85g", category: "Makanan", sellPrice: 3500, buyPrice: 3000, stock: 120, image: "" },
      { barcode: "8992741987012", name: "Aqua Air Mineral 600ml", category: "Minuman", sellPrice: 4000, buyPrice: 3200, stock: 85, image: "" },
      { barcode: "8998866200019", name: "Teh Botol Sosro Original 450ml", category: "Minuman", sellPrice: 6000, buyPrice: 4800, stock: 60, image: "" },
      { barcode: "8992800101015", name: "Ultra Milk Cokelat 250ml", category: "Minuman", sellPrice: 7000, buyPrice: 5800, stock: 45, image: "" },
      { barcode: "8992741911109", name: "Chitato Sapi Panggang 68g", category: "Makanan", sellPrice: 11500, buyPrice: 9500, stock: 30, image: "" },
      { barcode: "8991001100223", name: "Kopi Kapal Api Mix 10x25g", category: "Minuman", sellPrice: 15000, buyPrice: 12800, stock: 50, image: "" },
      { barcode: "8993005000018", name: "Le Minerale 600ml", category: "Minuman", sellPrice: 3500, buyPrice: 2800, stock: 90, image: "" },
      { barcode: "8992771000125", name: "Silverqueen Milk Chocolate 58g", category: "Makanan", sellPrice: 16500, buyPrice: 13500, stock: 25, image: "" }
    ];
    for (const item of samples) {
      await dbSaveProduct(item);
    }
  }
}

// ==================== 4. DOM ELEMENTS CACHE ====================
const elements = {
  splashScreen: document.getElementById("splashScreen"),
  onboardingScreen: document.getElementById("onboardingScreen"),
  appShell: document.getElementById("appShell"),
  
  // Views
  viewHome: document.getElementById("viewHome"),
  viewScan: document.getElementById("viewScan"),
  viewProducts: document.getElementById("viewProducts"),
  viewHistory: document.getElementById("viewHistory"),
  viewSettings: document.getElementById("viewSettings"),
  
  // Buttons & Navigation
  btnThemeToggle: document.getElementById("btnThemeToggle"),
  btnHeaderCart: document.getElementById("btnHeaderCart"),
  cartBadgeCount: document.getElementById("cartBadgeCount"),
  navItems: document.querySelectorAll(".nav-item"),
  btnNavScan: document.getElementById("btnNavScan"),
  
  // Home Elements
  homeStoreName: document.getElementById("homeStoreName"),
  homeStoreDesc: document.getElementById("homeStoreDesc"),
  statTotalProducts: document.getElementById("statTotalProducts"),
  statTotalScans: document.getElementById("statTotalScans"),
  homeSearchInput: document.getElementById("homeSearchInput"),
  btnClearHomeSearch: document.getElementById("btnClearHomeSearch"),
  homeSearchResults: document.getElementById("homeSearchResults"),
  homeRecentProducts: document.getElementById("homeRecentProducts"),
  btnSeeAllProducts: document.getElementById("btnSeeAllProducts"),
  
  // Menu Cards
  menuCardScan: document.getElementById("menuCardScan"),
  menuCardCashier: document.getElementById("menuCardCashier"),
  menuCardAdd: document.getElementById("menuCardAdd"),
  menuCardList: document.getElementById("menuCardList"),
  
  // Scanner View
  btnBackFromScan: document.getElementById("btnBackFromScan"),
  btnToggleFlash: document.getElementById("btnToggleFlash"),
  btnGalleryScan: document.getElementById("btnGalleryScan"),
  fileInputGallery: document.getElementById("fileInputGallery"),
  btnOpenManualScan: document.getElementById("btnOpenManualScan"),
  
  // Modals
  modalProductDetail: document.getElementById("modalProductDetail"),
  modalNotFound: document.getElementById("modalNotFound"),
  modalProductForm: document.getElementById("modalProductForm"),
  modalDuplicateBarcode: document.getElementById("modalDuplicateBarcode"),
  modalConfirmDelete: document.getElementById("modalConfirmDelete"),
  modalManualInput: document.getElementById("modalManualInput"),
  modalCashierCart: document.getElementById("modalCashierCart"),
  modalReceipt: document.getElementById("modalReceipt"),
  
  // Form Elements
  productForm: document.getElementById("productForm"),
  formTitle: document.getElementById("formTitle"),
  formProductId: document.getElementById("formProductId"),
  formBarcode: document.getElementById("formBarcode"),
  btnScanForForm: document.getElementById("btnScanForForm"),
  formName: document.getElementById("formName"),
  formCategory: document.getElementById("formCategory"),
  formSellPrice: document.getElementById("formSellPrice"),
  formBuyPrice: document.getElementById("formBuyPrice"),
  formStock: document.getElementById("formStock"),
  formMarginPreview: document.getElementById("formMarginPreview"),
  btnDeleteProductFromForm: document.getElementById("btnDeleteProductFromForm"),
  btnTriggerImagePicker: document.getElementById("btnTriggerImagePicker"),
  formFileInput: document.getElementById("formFileInput"),
  formImagePreview: document.getElementById("formImagePreview"),
  formImagePlaceholder: document.getElementById("formImagePlaceholder"),
  formImageData: document.getElementById("formImageData"),
  
  // Catalog View
  catalogSearchInput: document.getElementById("catalogSearchInput"),
  categoryFilterPills: document.getElementById("categoryFilterPills"),
  catalogSortSelect: document.getElementById("catalogSortSelect"),
  catalogCountText: document.getElementById("catalogCountText"),
  catalogProductList: document.getElementById("catalogProductList"),
  btnFabAddProduct: document.getElementById("btnFabAddProduct"),
  
  // Cashier & Cart
  btnCashierScanItem: document.getElementById("btnCashierScanItem"),
  btnClearCartItems: document.getElementById("btnClearCartItems"),
  cartItemsContainer: document.getElementById("cartItemsContainer"),
  cartTotalDisplay: document.getElementById("cartTotalDisplay"),
  inputCashReceived: document.getElementById("inputCashReceived"),
  cartChangeDisplay: document.getElementById("cartChangeDisplay"),
  btnFinishTransaction: document.getElementById("btnFinishTransaction"),
  btnCashExact: document.getElementById("btnCashExact"),
  
  // Settings & Profile
  settingStoreName: document.getElementById("settingStoreName"),
  settingStoreAddress: document.getElementById("settingStoreAddress"),
  settingReceiptFooter: document.getElementById("settingReceiptFooter"),
  btnSaveStoreProfile: document.getElementById("btnSaveStoreProfile"),
  btnExportData: document.getElementById("btnExportData"),
  btnRestoreData: document.getElementById("btnRestoreData"),
  fileInputRestore: document.getElementById("fileInputRestore"),
  btnSeedSampleData: document.getElementById("btnSeedSampleData"),
  btnResetAllData: document.getElementById("btnResetAllData"),

  // Onboarding Buttons
  btnNextOnboarding: document.getElementById("btnNextOnboarding"),
  btnSkipOnboarding: document.getElementById("btnSkipOnboarding")
};

// ==================== 5. NAVIGATION & VIEW CONTROLLER ====================
function switchView(viewId) {
  // Hide all views
  document.querySelectorAll(".app-view").forEach(v => v.classList.add("hidden"));
  
  // Show target view
  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.remove("hidden");
    appState.currentView = viewId;
  }

  // Update bottom nav icons
  elements.navItems.forEach(item => {
    if (item.dataset.view === viewId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // Camera cleanup if switching away from scan
  if (viewId !== "viewScan" && appState.isScanning) {
    stopCameraScanner();
  } else if (viewId === "viewScan") {
    startCameraScanner();
  }

  // Refresh view specific data
  if (viewId === "viewHome") {
    renderHomeView();
  } else if (viewId === "viewProducts") {
    renderCatalogView();
  } else if (viewId === "viewHistory") {
    renderHistoryView();
  }
}

// Modal System
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
    closeModal(document.getElementById(modalId));
  });
});

// ==================== 6. THEME CONTROLLER ====================
function applyTheme(theme) {
  appState.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("scanmart_theme", theme);
}

elements.btnThemeToggle.addEventListener("click", () => {
  const newTheme = appState.theme === "dark" ? "light" : "dark";
  applyTheme(newTheme);
});

// ==================== 7. SCANNER ENGINE (HTML5-QRCODE) ====================
function startCameraScanner() {
  if (appState.isScanning) return;
  appState.isScanning = true;

  if (!appState.activeScanner) {
    appState.activeScanner = new Html5Qrcode("html5QrcodeReader");
  }

  const config = {
    fps: 15,
    qrbox: { width: 240, height: 240 },
    aspectRatio: 1.0
  };

  appState.activeScanner.start(
    { facingMode: "environment" },
    config,
    onBarcodeScannedSuccess,
    onBarcodeScanError
  ).catch(err => {
    console.warn("Camera start error, falling back:", err);
  });
}

function stopCameraScanner() {
  if (appState.activeScanner && appState.isScanning) {
    appState.activeScanner.stop().then(() => {
      appState.isScanning = false;
    }).catch(err => console.log("Stop error:", err));
  } else {
    appState.isScanning = false;
  }
}

async function onBarcodeScannedSuccess(decodedText) {
  playBeepSound();
  triggerHaptic();
  
  appState.scannedBarcode = decodedText;
  stopCameraScanner();
  
  // Query product in DB
  const product = await dbGetProductByBarcode(decodedText);
  await dbAddScanHistory(product);
  
  if (product) {
    showProductDetailModal(product);
  } else {
    // Offer to create product with barcode pre-filled
    document.getElementById("notFoundBarcodeText").textContent = decodedText;
    openModal(elements.modalNotFound);
  }
}

function onBarcodeScanError(err) {
  // Silent frame scan errors
}

// Flashlight Toggle
let flashOn = false;
elements.btnToggleFlash.addEventListener("click", () => {
  if (appState.activeScanner && appState.isScanning) {
    flashOn = !flashOn;
    appState.activeScanner.applyVideoConstraints({
      advanced: [{ torch: flashOn }]
    }).catch(() => {
      alert("Senter tidak didukung pada perangkat ini.");
    });
  }
});

// Gallery Image Scan
elements.btnGalleryScan.addEventListener("click", () => {
  elements.fileInputGallery.click();
});

elements.fileInputGallery.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    const file = e.target.files[0];
    const html5QrCode = new Html5Qrcode("html5QrcodeReader");
    html5QrCode.scanFile(file, true)
      .then(decodedText => {
        onBarcodeScannedSuccess(decodedText);
      })
      .catch(err => {
        alert("Gagal membaca barcode dari gambar. Pastikan barcode terlihat jelas.");
      });
  }
});

// Manual Input
elements.btnOpenManualScan.addEventListener("click", () => {
  openModal(elements.modalManualInput);
});

document.getElementById("btnSubmitManualScan").addEventListener("click", () => {
  const code = document.getElementById("manualBarcodeCode").value.trim();
  if (code) {
    closeModal(elements.modalManualInput);
    document.getElementById("manualBarcodeCode").value = "";
    onBarcodeScannedSuccess(code);
  }
});

// ==================== 8. PRODUCT DETAIL & NOT FOUND MODALS ====================
function showProductDetailModal(product) {
  document.getElementById("detailCategoryBadge").textContent = product.category || "Umum";
  document.getElementById("detailProductName").textContent = product.name;
  document.getElementById("detailBarcodeText").textContent = product.barcode;
  document.getElementById("detailSellPrice").textContent = formatRupiah(product.sellPrice);
  document.getElementById("detailBuyPrice").textContent = formatRupiah(product.buyPrice || 0);
  
  const margin = (product.sellPrice || 0) - (product.buyPrice || 0);
  document.getElementById("detailMargin").textContent = formatRupiah(margin);
  document.getElementById("detailStock").textContent = `${product.stock || 0} pcs`;

  // Image preview
  const imgEl = document.getElementById("detailProductImage");
  const placeholderEl = document.getElementById("detailImagePlaceholder");
  if (product.image) {
    imgEl.src = product.image;
    imgEl.classList.remove("hidden");
    placeholderEl.classList.add("hidden");
  } else {
    imgEl.classList.add("hidden");
    placeholderEl.classList.remove("hidden");
  }

  // Setup Button Handlers
  document.getElementById("btnAddCartFromDetail").onclick = () => {
    addToCart(product);
    closeModal(elements.modalProductDetail);
    openModal(elements.modalCashierCart);
  };

  document.getElementById("btnEditFromDetail").onclick = () => {
    closeModal(elements.modalProductDetail);
    openProductForm(product);
  };

  document.getElementById("btnScanAgainFromDetail").onclick = () => {
    closeModal(elements.modalProductDetail);
    switchView("viewScan");
  };

  openModal(elements.modalProductDetail);
}

document.getElementById("btnCreateWithBarcode").addEventListener("click", () => {
  closeModal(elements.modalNotFound);
  openProductForm({ barcode: appState.scannedBarcode });
});

// ==================== 9. PRODUCT CRUD & ANTI-DUPLICATE ====================
function openProductForm(product = null) {
  elements.productForm.reset();
  elements.formMarginPreview.textContent = "Rp 0";
  elements.formImagePreview.classList.add("hidden");
  elements.formImagePlaceholder.classList.remove("hidden");
  elements.formImageData.value = "";

  if (product && product.id) {
    elements.formTitle.textContent = "Edit Produk";
    elements.formProductId.value = product.id;
    elements.formBarcode.value = product.barcode || "";
    elements.formName.value = product.name || "";
    elements.formCategory.value = product.category || "Makanan";
    elements.formSellPrice.value = product.sellPrice || "";
    elements.formBuyPrice.value = product.buyPrice || "";
    elements.formStock.value = product.stock || 0;
    
    if (product.image) {
      elements.formImagePreview.src = product.image;
      elements.formImagePreview.classList.remove("hidden");
      elements.formImagePlaceholder.classList.add("hidden");
      elements.formImageData.value = product.image;
    }

    elements.btnDeleteProductFromForm.classList.remove("hidden");
    updateMarginCalculation();
  } else {
    elements.formTitle.textContent = "Tambah Produk Baru";
    elements.formProductId.value = "";
    if (product && product.barcode) {
      elements.formBarcode.value = product.barcode;
    }
    elements.btnDeleteProductFromForm.classList.add("hidden");
  }

  openModal(elements.modalProductForm);
}

// Image Picker Handling
elements.btnTriggerImagePicker.addEventListener("click", () => {
  elements.formFileInput.click();
});

elements.formFileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (evt) => {
      elements.formImagePreview.src = evt.target.result;
      elements.formImagePreview.classList.remove("hidden");
      elements.formImagePlaceholder.classList.add("hidden");
      elements.formImageData.value = evt.target.result;
    };
    reader.readAsDataURL(file);
  }
});

// Auto Margin Calculation
function updateMarginCalculation() {
  const sell = Number(elements.formSellPrice.value) || 0;
  const buy = Number(elements.formBuyPrice.value) || 0;
  elements.formMarginPreview.textContent = formatRupiah(sell - buy);
}
elements.formSellPrice.addEventListener("input", updateMarginCalculation);
elements.formBuyPrice.addEventListener("input", updateMarginCalculation);

// Save Product Submission (with Anti-Duplicate Check)
elements.productForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = elements.formProductId.value ? Number(elements.formProductId.value) : null;
  const barcode = elements.formBarcode.value.trim();
  const name = elements.formName.value.trim();
  const category = elements.formCategory.value;
  const sellPrice = Number(elements.formSellPrice.value);
  const buyPrice = Number(elements.formBuyPrice.value) || 0;
  const stock = Number(elements.formStock.value) || 0;
  const image = elements.formImageData.value;

  if (!barcode || !name || isNaN(sellPrice)) {
    alert("Mohon lengkapi data barcode, nama, dan harga jual!");
    return;
  }

  // Anti-Duplicate Barcode Check
  const existing = await dbGetProductByBarcode(barcode);
  if (existing && existing.id !== id) {
    appState.duplicateProductTarget = existing;
    document.getElementById("duplicateBarcodeNum").textContent = barcode;
    document.getElementById("duplicateProductName").textContent = existing.name;
    openModal(elements.modalDuplicateBarcode);
    return; // Cancel save!
  }

  // Save to DB
  await dbSaveProduct({
    id: id || undefined,
    barcode,
    name,
    category,
    sellPrice,
    buyPrice,
    stock,
    image
  });

  closeModal(elements.modalProductForm);
  renderHomeView();
  renderCatalogView();
});

// View Duplicate Product Action
document.getElementById("btnViewDuplicateProduct").addEventListener("click", () => {
  closeModal(elements.modalDuplicateBarcode);
  closeModal(elements.modalProductForm);
  if (appState.duplicateProductTarget) {
    showProductDetailModal(appState.duplicateProductTarget);
  }
});

// Delete Product Confirmation Flow
elements.btnDeleteProductFromForm.addEventListener("click", () => {
  appState.targetDeleteId = Number(elements.formProductId.value);
  document.getElementById("deleteTargetName").textContent = elements.formName.value;
  openModal(elements.modalConfirmDelete);
});

document.getElementById("btnConfirmDeleteExecution").addEventListener("click", async () => {
  if (appState.targetDeleteId) {
    await dbDeleteProduct(appState.targetDeleteId);
    closeModal(elements.modalConfirmDelete);
    closeModal(elements.modalProductForm);
    renderHomeView();
    renderCatalogView();
  }
});

// Scan Button inside Form
elements.btnScanForForm.addEventListener("click", () => {
  closeModal(elements.modalProductForm);
  switchView("viewScan");
});

// ==================== 10. KASIR & KERANJANG BELANJA (CASHIER CART) ====================
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
  elements.cartBadgeCount.textContent = totalCount;

  // Render items in cart modal
  elements.cartItemsContainer.innerHTML = "";
  let grandTotal = 0;

  if (appState.cart.length === 0) {
    elements.cartItemsContainer.innerHTML = `
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
      elements.cartItemsContainer.appendChild(card);
    });
  }

  elements.cartTotalDisplay.textContent = formatRupiah(grandTotal);
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

elements.btnClearCartItems.addEventListener("click", () => {
  if (confirm("Kosongkan seluruh keranjang belanja?")) {
    appState.cart = [];
    updateCartUI();
  }
});

// Calculate Change Due
function calculateChangeDue() {
  const grandTotal = appState.cart.reduce((sum, item) => sum + (item.product.sellPrice * item.qty), 0);
  const cash = Number(elements.inputCashReceived.value) || 0;
  const change = cash - grandTotal;

  const changeCard = elements.cartChangeDisplay;
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

elements.inputCashReceived.addEventListener("input", calculateChangeDue);

// Cash Shortcut Tags
document.querySelectorAll(".btn-cash-tag").forEach(btn => {
  btn.addEventListener("click", () => {
    const grandTotal = appState.cart.reduce((sum, item) => sum + (item.product.sellPrice * item.qty), 0);
    if (btn.id === "btnCashExact") {
      elements.inputCashReceived.value = grandTotal;
    } else {
      elements.inputCashReceived.value = btn.dataset.val;
    }
    calculateChangeDue();
  });
});

// Finish Transaction & Receipt
elements.btnFinishTransaction.addEventListener("click", async () => {
  const grandTotal = appState.cart.reduce((sum, item) => sum + (item.product.sellPrice * item.qty), 0);
  const cash = Number(elements.inputCashReceived.value) || 0;

  if (appState.cart.length === 0) {
    alert("Keranjang masih kosong!");
    return;
  }

  if (cash < grandTotal) {
    alert("Uang pembeli masih kurang dari total belanja!");
    return;
  }

  // Deduct stock in DB
  for (const item of appState.cart) {
    if (item.product.id) {
      const current = await dbGetProductByBarcode(item.product.barcode);
      if (current) {
        current.stock = Math.max(0, (current.stock || 0) - item.qty);
        await dbSaveProduct(current);
      }
    }
  }

  // Render Receipt
  document.getElementById("receiptStoreName").textContent = appState.storeProfile.name;
  document.getElementById("receiptStoreAddress").textContent = appState.storeProfile.address;
  document.getElementById("receiptFooterText").textContent = appState.storeProfile.footer;
  document.getElementById("receiptDate").textContent = formatDateTime(new Date());

  const itemsContainer = document.getElementById("receiptItemsList");
  itemsContainer.innerHTML = "";
  appState.cart.forEach(item => {
    const row = document.createElement("div");
    row.className = "receipt-row";
    row.innerHTML = `
      <span>${escapeHtml(item.product.name)} (${item.qty}x)</span>
      <span>${formatRupiah(item.product.sellPrice * item.qty)}</span>
    `;
    itemsContainer.appendChild(row);
  });

  document.getElementById("receiptTotal").textContent = formatRupiah(grandTotal);
  document.getElementById("receiptCash").textContent = formatRupiah(cash);
  document.getElementById("receiptChange").textContent = formatRupiah(cash - grandTotal);

  closeModal(elements.modalCashierCart);
  openModal(elements.modalReceipt);

  // Clear Cart
  appState.cart = [];
  elements.inputCashReceived.value = "";
  updateCartUI();
  renderHomeView();
});

document.getElementById("btnCloseReceipt").addEventListener("click", () => {
  closeModal(elements.modalReceipt);
});

elements.btnCashierScanItem.addEventListener("click", () => {
  closeModal(elements.modalCashierCart);
  switchView("viewScan");
});

elements.btnHeaderCart.addEventListener("click", () => {
  openModal(elements.modalCashierCart);
});

// ==================== 11. HOME & CATALOG RENDERERS ====================
async function updateRecentStats() {
  const products = await dbGetAllProducts();
  const scans = await dbGetScanHistory();
  
  elements.statTotalProducts.textContent = products.length;
  elements.statTotalScans.textContent = scans.length;
}

async function renderHomeView() {
  updateRecentStats();
  elements.homeStoreName.textContent = appState.storeProfile.name;
  
  const products = await dbGetAllProducts();
  const recent = products.slice(-5).reverse();

  elements.homeRecentProducts.innerHTML = "";
  if (recent.length === 0) {
    elements.homeRecentProducts.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted);">
        Belum ada produk terdaftar. Klik 'Tambah Produk' untuk menginput barang.
      </div>
    `;
  } else {
    recent.forEach(p => {
      elements.homeRecentProducts.appendChild(createProductItemCard(p));
    });
  }
}

async function renderCatalogView() {
  const products = await dbGetAllProducts();
  const query = elements.catalogSearchInput.value.toLowerCase().trim();
  const activeCat = document.querySelector(".pill-btn.active")?.dataset.cat || "all";
  const sortBy = elements.catalogSortSelect.value;

  let filtered = products.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(query) || p.barcode.toLowerCase().includes(query);
    const matchCat = activeCat === "all" || p.category === activeCat;
    return matchQuery && matchCat;
  });

  // Sorting
  filtered.sort((a, b) => {
    if (sortBy === "name_asc") return a.name.localeCompare(b.name);
    if (sortBy === "price_asc") return a.sellPrice - b.sellPrice;
    if (sortBy === "price_desc") return b.sellPrice - a.sellPrice;
    if (sortBy === "stock_asc") return a.stock - b.stock;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0); // newest
  });

  elements.catalogCountText.textContent = `Menampilkan ${filtered.length} dari ${products.length} produk`;
  elements.catalogProductList.innerHTML = "";

  if (filtered.length === 0) {
    elements.catalogProductList.innerHTML = `
      <div style="text-align: center; padding: 40px 0; color: var(--text-muted);">
        <i class="fa-solid fa-box-open" style="font-size: 48px; margin-bottom: 12px;"></i>
        <p>Tidak ada produk yang cocok dengan pencarian.</p>
      </div>
    `;
  } else {
    filtered.forEach(p => {
      elements.catalogProductList.appendChild(createProductItemCard(p));
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

// Quick Search on Home View
elements.homeSearchInput.addEventListener("input", async (e) => {
  const query = e.target.value.toLowerCase().trim();
  if (!query) {
    elements.homeSearchResults.classList.add("hidden");
    elements.btnClearHomeSearch.classList.add("hidden");
    return;
  }

  elements.btnClearHomeSearch.classList.remove("hidden");
  const products = await dbGetAllProducts();
  const results = products.filter(p => p.name.toLowerCase().includes(query) || p.barcode.toLowerCase().includes(query)).slice(0, 5);

  elements.homeSearchResults.innerHTML = "";
  if (results.length === 0) {
    elements.homeSearchResults.innerHTML = `<div class="dropdown-item"><span>Tidak ditemukan</span></div>`;
  } else {
    results.forEach(p => {
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <div style="font-size: 11px; color: var(--text-muted);">${p.barcode}</div>
        </div>
        <div style="font-weight: 700; color: var(--neon-green);">${formatRupiah(p.sellPrice)}</div>
      `;
      item.onclick = () => {
        elements.homeSearchResults.classList.add("hidden");
        showProductDetailModal(p);
      };
      elements.homeSearchResults.appendChild(item);
    });
  }
  elements.homeSearchResults.classList.remove("hidden");
});

elements.btnClearHomeSearch.addEventListener("click", () => {
  elements.homeSearchInput.value = "";
  elements.homeSearchResults.classList.add("hidden");
  elements.btnClearHomeSearch.classList.add("hidden");
});

// ==================== 12. HISTORY VIEW RENDERER ====================
async function renderHistoryView() {
  const history = await dbGetScanHistory();
  elements.scanHistoryList.innerHTML = "";

  if (history.length === 0) {
    elements.scanHistoryList.innerHTML = `
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
      elements.scanHistoryList.appendChild(card);
    });
  }
}

elements.btnClearScanHistory.addEventListener("click", async () => {
  if (confirm("Hapus seluruh riwayat scan barcode?")) {
    await dbClearScanHistory();
    renderHistoryView();
    updateRecentStats();
  }
});

// ==================== 13. SETTINGS & BACKUP/RESTORE ENGINE ====================
// Save Store Profile
elements.btnSaveStoreProfile.addEventListener("click", () => {
  appState.storeProfile.name = elements.settingStoreName.value.trim() || "Toko ScanMart";
  appState.storeProfile.address = elements.settingStoreAddress.value.trim();
  appState.storeProfile.footer = elements.settingReceiptFooter.value.trim();
  
  localStorage.setItem("scanmart_store", JSON.stringify(appState.storeProfile));
  alert("Profil toko berhasil disimpan!");
  renderHomeView();
});

// Export JSON Backup
elements.btnExportData.addEventListener("click", async () => {
  const products = await dbGetAllProducts();
  const backupData = {
    app: "ScanMart",
    version: "1.0.0",
    exportDate: new Date().toISOString(),
    storeProfile: appState.storeProfile,
    products: products
  };

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `ScanMart_Backup_${formatFileTimestamp(new Date())}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
});

// Restore JSON Backup
elements.btnRestoreData.addEventListener("click", () => {
  elements.fileInputRestore.click();
});

elements.fileInputRestore.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed && Array.isArray(parsed.products)) {
          for (const item of parsed.products) {
            delete item.id; // allow auto-increment or put
            await dbSaveProduct(item);
          }
          alert(`Berhasil mengimpor ${parsed.products.length} data produk!`);
          renderHomeView();
          renderCatalogView();
        } else {
          alert("Format file JSON tidak valid.");
        }
      } catch (err) {
        alert("Gagal membaca file JSON.");
      }
    };
    reader.readAsText(file);
  }
});

// Seed Sample Data
elements.btnSeedSampleData.addEventListener("click", async () => {
  await seedSampleDataIfNeeded();
  alert("Sampel data produk minimarket berhasil dimasukkan!");
  renderHomeView();
  renderCatalogView();
});

// Reset All Data
elements.btnResetAllData.addEventListener("click", async () => {
  if (confirm("APAKAH ANDA YAKIN? Seluruh produk dan riwayat akan dihapus permanen!")) {
    const products = await dbGetAllProducts();
    for (const p of products) {
      await dbDeleteProduct(p.id);
    }
    await dbClearScanHistory();
    alert("Database berhasil dikosongkan.");
    renderHomeView();
    renderCatalogView();
  }
});

// ==================== 14. HELPER UTILITIES ====================
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

function formatFileTimestamp(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[m]);
}

// Category Pill Filter click
elements.categoryFilterPills.addEventListener("click", (e) => {
  if (e.target.classList.contains("pill-btn")) {
    document.querySelectorAll(".pill-btn").forEach(p => p.classList.remove("active"));
    e.target.classList.add("active");
    renderCatalogView();
  }
});

elements.catalogSearchInput.addEventListener("input", renderCatalogView);
elements.catalogSortSelect.addEventListener("change", renderCatalogView);

// Main Action Cards
elements.menuCardScan.onclick = () => switchView("viewScan");
elements.menuCardCashier.onclick = () => openModal(elements.modalCashierCart);
elements.menuCardAdd.onclick = () => openProductForm();
elements.menuCardList.onclick = () => switchView("viewProducts");

elements.btnNavScan.onclick = () => switchView("viewScan");
elements.btnFabAddProduct.onclick = () => openProductForm();
elements.btnSeeAllProducts.onclick = () => switchView("viewProducts");
elements.btnBackFromScan.onclick = () => switchView("viewHome");

// Bottom Nav Delegation
elements.navItems.forEach(item => {
  item.addEventListener("click", () => {
    switchView(item.dataset.view);
  });
});

// Onboarding Controller
elements.btnNextOnboarding.addEventListener("click", () => {
  const slides = document.querySelectorAll(".onboarding-slide");
  const dots = document.querySelectorAll(".dot");
  let activeIndex = 0;
  
  slides.forEach((s, idx) => {
    if (s.classList.contains("active")) activeIndex = idx;
  });

  if (activeIndex < slides.length - 1) {
    slides[activeIndex].classList.remove("active");
    dots[activeIndex].classList.remove("active");
    
    slides[activeIndex + 1].classList.add("active");
    dots[activeIndex + 1].classList.add("active");
  } else {
    completeOnboarding();
  }
});

elements.btnSkipOnboarding.addEventListener("click", completeOnboarding);

function completeOnboarding() {
  localStorage.setItem("scanmart_onboarded", "true");
  elements.onboardingScreen.classList.add("hidden");
  elements.appShell.classList.remove("hidden");
  switchView("viewHome");
}

// ==================== 15. INITIALIZATION BOOTSTRAP ====================
window.addEventListener("DOMContentLoaded", async () => {
  applyTheme(appState.theme);

  // Initialize IndexedDB
  await initDatabase();
  await seedSampleDataIfNeeded();

  // Load Settings into UI
  elements.settingStoreName.value = appState.storeProfile.name;
  elements.settingStoreAddress.value = appState.storeProfile.address || "";
  elements.settingReceiptFooter.value = appState.storeProfile.footer || "";

  // Splash Screen Timeout
  setTimeout(() => {
    elements.splashScreen.classList.add("hidden");
    if (!appState.onboarded) {
      elements.onboardingScreen.classList.remove("hidden");
    } else {
      elements.appShell.classList.remove("hidden");
      switchView("viewHome");
    }
  }, 1800);
});
