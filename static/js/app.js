/**
 * app.js — Smart Inventory & Expiration Manager
 * Fetch API ile sayfa yenilenmeden tüm işlemler.
 * Modüler ve açıklamalı yapı.
 */

'use strict';

// ─────────────────────────────────────────────
// Sabitler & Global state
// ─────────────────────────────────────────────

const API = '';          // Flask aynı origin'de çalıştığı için prefix gerekmez
let allProducts  = [];   // Sunucudan gelen tüm ürünler (önbellekleme)
let editMode     = false;

// Kategori → emoji ikonu eşlemesi
const CATEGORY_ICONS = {
  'Gıda':          '🍎',
  'İçecek':        '🥤',
  'Temizlik':      '🧴',
  'Kişisel Bakım': '💆',
  'Eczane':        '💊',
  'Diğer':         '📦',
};


// ─────────────────────────────────────────────
// Navigasyon
// ─────────────────────────────────────────────

function navigate(section) {
  // Tüm sectionsları gizle
  document.querySelectorAll('[id^="section"]').forEach(el => el.classList.add('d-none'));
  // Sidebar link aktif sınıfı
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));

  const map = {
    dashboard: { title: 'Dashboard',     sub: 'Genel stok durumuna genel bakış',   section: 'Dashboard' },
    products:  { title: 'Ürünler',       sub: 'Tüm aktif ürünleri yönetin',         section: 'Products' },
    logs:      { title: 'İşlem Logları', sub: 'Stok değişim geçmişi',               section: 'Logs' },
    import:    { title: 'CSV Import',    sub: 'Toplu ürün içe aktarma',              section: 'Import' },
  };

  const cfg = map[section] || map.dashboard;
  document.getElementById('pageTitle').textContent    = cfg.title;
  document.getElementById('pageSubtitle').textContent = cfg.sub;
  document.getElementById(`section${cfg.section}`).classList.remove('d-none');

  const activeLink = document.querySelector(`.sidebar-link[data-section="${section}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Veriyi yükle
  if (section === 'dashboard') { loadStats(); loadDashboardProducts(); }
  if (section === 'products')  loadProducts();
  if (section === 'logs')      loadLogs();
}


// ─────────────────────────────────────────────
// API yardımcıları
// ─────────────────────────────────────────────

async function apiFetch(endpoint, options = {}) {
  try {
    const res  = await fetch(API + endpoint, options);
    const json = await res.json();
    return json;
  } catch (e) {
    showToast('Sunucuya bağlanılamadı.', 'error');
    return { success: false, message: 'Bağlantı hatası' };
  }
}


// ─────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────

async function loadStats() {
  const res = await apiFetch('/api/stats');
  if (!res.success) return;
  const d = res.data;
  document.getElementById('statTotal').textContent      = d.total;
  document.getElementById('statCritical').textContent   = d.critical;
  document.getElementById('statLowStock').textContent   = d.low_stock;
  document.getElementById('statCategories').textContent = d.categories;

  document.getElementById('lastUpdated').textContent =
    'Son güncelleme: ' + new Date().toLocaleTimeString('tr-TR');
}

async function loadDashboardProducts() {
  const res = await apiFetch('/api/products');
  if (!res.success) return;

  // Kritik ve düşük stoklu ürünleri filtrele
  const critical = res.data.filter(p =>
    p.status === 'Kritik' || p.status === 'Tarihi Geçti' || p.stock <= 5
  ).slice(0, 10);

  const container = document.getElementById('dashboardTable');

  if (!critical.length) {
    container.innerHTML = `<div class="text-center py-5 text-muted">
      <i class="bi bi-check-circle display-5 d-block mb-2 text-success"></i>
      Kritik ürün bulunmuyor 🎉
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle mb-0">
        <thead class="table-header">
          <tr><th></th><th>Ürün</th><th>Stok</th><th>SKT</th><th>Durum</th></tr>
        </thead>
        <tbody>${critical.map(p => renderProductRow(p, true)).join('')}</tbody>
      </table>
    </div>`;
}


// ─────────────────────────────────────────────
// Ürün listesi
// ─────────────────────────────────────────────

async function loadProducts() {
  document.getElementById('productsBody').innerHTML =
    `<tr><td colspan="7" class="text-center py-5 text-muted">
       <div class="spinner-border spinner-border-sm me-2"></div>Yükleniyor…
     </td></tr>`;

  const res = await apiFetch('/api/products');
  if (!res.success) return;
  allProducts = res.data;
  renderProductsTable(allProducts);
}

function renderProductsTable(products) {
  const tbody = document.getElementById('productsBody');
  if (!products.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-5 text-muted">
      <i class="bi bi-inbox display-5 d-block mb-2"></i>Ürün bulunamadı
    </td></tr>`;
    return;
  }
  tbody.innerHTML = products.map(p => renderProductRow(p, false)).join('');
}

function renderProductRow(p, minimal = false) {
  const icon   = CATEGORY_ICONS[p.category] || '📦';
  const imgEl  = p.image_url
    ? `<img src="${escHtml(p.image_url)}" class="product-img" alt="${escHtml(p.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const iconEl = `<div class="product-icon" ${p.image_url ? 'style="display:none"' : ''}>${icon}</div>`;

  const statusInfo = getStatusDisplay(p.status);
  const rowClass   = p.status === 'Tarihi Geçti' ? 'row-expired'
                   : p.status === 'Kritik'       ? 'row-critical' : '';
  const stockClass = p.stock <= 5                ? 'stock-low'    : '';

  const sktText = p.expiry_date
    ? `${p.expiry_date} <span class="text-muted small">(${p.days_until_expiry !== null ? p.days_until_expiry + ' gün' : '?'})</span>`
    : '<span class="text-muted">—</span>';

  const actions = minimal ? '' : `
    <div class="d-flex gap-1 justify-content-end flex-wrap">
      <button class="btn btn-outline-success btn-icon" onclick="openStockModal(${p.id},'${escHtml(p.name)}')" title="Stok Güncelle">
        <i class="bi bi-arrow-left-right"></i>
      </button>
      <button class="btn btn-outline-primary btn-icon" onclick="openEditModal(${p.id})" title="Düzenle">
        <i class="bi bi-pencil"></i>
      </button>
      <button class="btn btn-outline-danger btn-icon" onclick="deleteProduct(${p.id},'${escHtml(p.name)}')" title="Sil">
        <i class="bi bi-trash3"></i>
      </button>
    </div>`;

  return `<tr class="${rowClass} fade-in">
    <td><div class="d-flex">${imgEl}${iconEl}</div></td>
    <td>
      <div class="fw-semibold">${escHtml(p.name)}</div>
      ${p.barcode ? `<div class="text-muted small">${escHtml(p.barcode)}</div>` : ''}
    </td>
    ${!minimal ? `<td><span class="text-muted small">${escHtml(p.category)}</span></td>` : ''}
    <td><span class="${stockClass}">${p.stock}</span></td>
    <td class="small">${sktText}</td>
    <td><span class="status-badge ${statusInfo.cls}">${statusInfo.text}</span></td>
    ${!minimal ? `<td>${actions}</td>` : ''}
  </tr>`;
}

function getStatusDisplay(status) {
  switch (status) {
    case 'Normal':        return { cls: 'badge-normal',   text: '✓ Normal' };
    case 'Kritik':        return { cls: 'badge-critical',  text: '⚠ Kritik' };
    case 'Tarihi Geçti':  return { cls: 'badge-expired',   text: '✗ SKT Geçti' };
    default:              return { cls: 'badge-unknown',   text: '? Belirsiz' };
  }
}

function filterProducts() {
  const search   = document.getElementById('searchInput').value.toLowerCase();
  const category = document.getElementById('categoryFilter').value;
  const filtered = allProducts.filter(p =>
    (!search   || p.name.toLowerCase().includes(search) || (p.barcode || '').includes(search)) &&
    (!category || p.category === category)
  );
  renderProductsTable(filtered);
}


// ─────────────────────────────────────────────
// Ürün Ekle / Düzenle Modal
// ─────────────────────────────────────────────

function openAddModal() {
  editMode = false;
  document.getElementById('productModalLabel').innerHTML = '<i class="bi bi-plus-circle me-2"></i>Yeni Ürün Ekle';
  document.getElementById('editProductId').value = '';
  ['pName','pBarcode','pImageUrl','pExpiry'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pStock').value = '0';
  document.getElementById('pCategory').value = 'Gıda';
  document.getElementById('previewContainer').classList.add('d-none');
  new bootstrap.Modal(document.getElementById('productModal')).show();
}

async function openEditModal(id) {
  editMode = true;
  document.getElementById('productModalLabel').innerHTML = '<i class="bi bi-pencil me-2"></i>Ürün Düzenle';

  const res = await apiFetch(`/api/products/${id}`);
  if (!res.success) { showToast(res.message, 'error'); return; }

  const p = res.data;
  document.getElementById('editProductId').value = p.id;
  document.getElementById('pName').value      = p.name;
  document.getElementById('pBarcode').value   = p.barcode || '';
  document.getElementById('pCategory').value  = p.category;
  document.getElementById('pStock').value     = p.stock;
  document.getElementById('pExpiry').value    = p.expiry_date || '';
  document.getElementById('pImageUrl').value  = p.image_url || '';
  previewImage();

  new bootstrap.Modal(document.getElementById('productModal')).show();
}

async function saveProduct() {
  const name    = document.getElementById('pName').value.trim();
  const barcode = document.getElementById('pBarcode').value.trim();
  const cat     = document.getElementById('pCategory').value;
  const stock   = parseInt(document.getElementById('pStock').value) || 0;
  const expiry  = document.getElementById('pExpiry').value || null;
  const imgUrl  = document.getElementById('pImageUrl').value.trim() || null;

  if (!name) { showToast('Ürün adı zorunludur.', 'error'); return; }

  const body = JSON.stringify({ name, barcode, category: cat, stock, expiry_date: expiry, image_url: imgUrl });
  const headers = { 'Content-Type': 'application/json' };

  let res;
  if (editMode) {
    const id = document.getElementById('editProductId').value;
    res = await apiFetch(`/api/products/${id}`, { method: 'PUT', headers, body });
  } else {
    res = await apiFetch('/api/products', { method: 'POST', headers, body });
  }

  if (res.success) {
    bootstrap.Modal.getInstance(document.getElementById('productModal')).hide();
    showToast(res.message, 'success');
    loadProducts();
    loadStats();
  } else {
    showToast(res.message, 'error');
  }
}

function previewImage() {
  const url = document.getElementById('pImageUrl').value.trim();
  const container = document.getElementById('previewContainer');
  const img       = document.getElementById('imagePreview');
  if (url) {
    img.src = url;
    container.classList.remove('d-none');
  } else {
    container.classList.add('d-none');
  }
}


// ─────────────────────────────────────────────
// Ürün Sil (Soft Delete)
// ─────────────────────────────────────────────

async function deleteProduct(id, name) {
  if (!confirm(`"${name}" ürününü silmek istediğinize emin misiniz?\n(Veri kalıcı olarak silinmez, gizlenir.)`)) return;

  const res = await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
  if (res.success) {
    showToast(res.message, 'success');
    loadProducts();
    loadStats();
  } else {
    showToast(res.message, 'error');
  }
}


// ─────────────────────────────────────────────
// Stok Güncelleme Modal
// ─────────────────────────────────────────────

function openStockModal(id, name) {
  document.getElementById('stockProductId').value = id;
  document.getElementById('stockProductName').textContent = `Ürün: ${name}`;
  document.getElementById('stockQty').value  = '1';
  document.getElementById('stockNote').value = '';
  selectAction('add');
  new bootstrap.Modal(document.getElementById('stockModal')).show();
}

function selectAction(action) {
  document.getElementById('stockAction').value = action;
  const btnAdd    = document.getElementById('btnAdd');
  const btnRemove = document.getElementById('btnRemove');
  if (action === 'add') {
    btnAdd.className    = 'btn btn-success flex-fill stock-action-btn';
    btnRemove.className = 'btn btn-outline-danger flex-fill stock-action-btn';
  } else {
    btnAdd.className    = 'btn btn-outline-success flex-fill stock-action-btn';
    btnRemove.className = 'btn btn-danger flex-fill stock-action-btn';
  }
}

async function submitStock() {
  const id       = document.getElementById('stockProductId').value;
  const action   = document.getElementById('stockAction').value;
  const quantity = parseInt(document.getElementById('stockQty').value);
  const note     = document.getElementById('stockNote').value.trim();

  if (!quantity || quantity <= 0) { showToast('Geçerli bir miktar girin.', 'error'); return; }

  const res = await apiFetch(`/api/products/${id}/stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, quantity, note })
  });

  if (res.success) {
    bootstrap.Modal.getInstance(document.getElementById('stockModal')).hide();
    showToast(res.message, 'success');
    loadProducts();
    loadStats();
  } else {
    showToast(res.message, 'error');
  }
}


// ─────────────────────────────────────────────
// Barkod Arama
// ─────────────────────────────────────────────

function openBarcodeModal() {
  document.getElementById('barcodeInput').value = '';
  document.getElementById('barcodeResult').innerHTML = '';
  new bootstrap.Modal(document.getElementById('barcodeModal')).show();
  setTimeout(() => document.getElementById('barcodeInput').focus(), 400);
}

// Ürün modal içinden barkod arama
async function lookupBarcode() {
  const barcode = document.getElementById('pBarcode').value.trim();
  if (!barcode) { showToast('Barkod alanı boş.', 'error'); return; }
  await _fetchBarcode(barcode, true);
}

async function searchBarcode() {
  const barcode = document.getElementById('barcodeInput').value.trim();
  if (!barcode) return;

  document.getElementById('barcodeResult').innerHTML =
    `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Aranıyor…</div>`;

  await _fetchBarcode(barcode, false);
}

async function _fetchBarcode(barcode, fillModal) {
  const res = await apiFetch(`/api/barcode/${barcode}`);

  if (!res.success) {
    if (fillModal) { showToast('Barkod bulunamadı.', 'error'); return; }
    document.getElementById('barcodeResult').innerHTML =
      `<div class="alert alert-danger py-2">${escHtml(res.message)}</div>`;
    return;
  }

  const d = res.data;

  if (fillModal) {
    // Ürün ekleme modalına doldur
    if (d.name)      document.getElementById('pName').value     = d.name;
    if (d.image_url) document.getElementById('pImageUrl').value = d.image_url;
    if (d.category)  document.getElementById('pCategory').value = d.category;
    previewImage();
    showToast('Barkod bilgisi dolduruldu!', 'success');
  } else {
    document.getElementById('barcodeResult').innerHTML = `
      <div class="card glass-card p-3 fade-in">
        ${d.image_url ? `<img src="${escHtml(d.image_url)}" class="img-fluid rounded mb-2" style="max-height:120px;object-fit:contain">` : ''}
        <div class="fw-semibold">${escHtml(d.name || 'İsimsiz ürün')}</div>
        <div class="text-muted small mb-3">${escHtml(d.category || '')}</div>
        <button class="btn btn-sm btn-primary w-100" onclick="
          bootstrap.Modal.getInstance(document.getElementById('barcodeModal')).hide();
          openAddModal();
          setTimeout(()=>{
            document.getElementById('pBarcode').value   = '${escHtml(barcode)}';
            document.getElementById('pName').value      = '${escHtml(d.name || '')}';
            document.getElementById('pImageUrl').value  = '${escHtml(d.image_url || '')}';
            previewImage();
          },400)">
          <i class="bi bi-plus-lg me-1"></i>Bu Ürünü Ekle
        </button>
      </div>`;
  }
}


// ─────────────────────────────────────────────
// Loglar
// ─────────────────────────────────────────────

async function loadLogs() {
  document.getElementById('logsBody').innerHTML =
    `<tr><td colspan="6" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Yükleniyor…</td></tr>`;

  const res = await apiFetch('/api/logs?limit=100');
  const tbody = document.getElementById('logsBody');
  if (!res.success || !res.data.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted"><i class="bi bi-journal-x display-5 d-block mb-2"></i>Log kaydı bulunamadı</td></tr>`;
    return;
  }

  const actionLabel = {
    ADD:    '<span class="log-add">▲ Stok Eklendi</span>',
    REMOVE: '<span class="log-remove">▼ Stok Azaltıldı</span>',
    CREATE: '<span class="log-create">✦ Ürün Oluşturuldu</span>',
    UPDATE: '<span class="log-update">✎ Güncellendi</span>',
    DELETE: '<span class="log-delete">✖ Silindi</span>',
  };

  tbody.innerHTML = res.data.map(l => `
    <tr class="fade-in">
      <td class="text-muted small">#${l.id}</td>
      <td class="fw-semibold">${escHtml(l.product_name || '—')}</td>
      <td>${actionLabel[l.action_type] || escHtml(l.action_type)}</td>
      <td>${l.quantity !== null ? (l.quantity > 0 ? '+' : '') + l.quantity : '—'}</td>
      <td class="text-muted small">${escHtml(l.note || '—')}</td>
      <td class="text-muted small">${l.created_at}</td>
    </tr>`).join('');
}


// ─────────────────────────────────────────────
// CSV Import
// ─────────────────────────────────────────────

let selectedFile = null;

function handleDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) setImportFile(file);
}

function handleFileSelect(input) {
  if (input.files[0]) setImportFile(input.files[0]);
}

function setImportFile(file) {
  selectedFile = file;
  document.getElementById('dropzone').innerHTML = `
    <i class="bi bi-file-earmark-check display-5 text-success mb-2 d-block"></i>
    <p class="fw-semibold">${escHtml(file.name)}</p>
    <p class="text-muted small">${(file.size / 1024).toFixed(1)} KB</p>`;
  document.getElementById('btnImport').disabled = false;
}

async function importCSV() {
  if (!selectedFile) return;
  const btn = document.getElementById('btnImport');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-border spinner-border-sm me-2"></div>İşleniyor…';

  const formData = new FormData();
  formData.append('file', selectedFile);

  const res = await apiFetch('/api/import', { method: 'POST', body: formData });
  const resultDiv = document.getElementById('importResult');
  resultDiv.classList.remove('d-none');

  if (res.success) {
    resultDiv.innerHTML = `
      <div class="alert alert-success py-2">
        <i class="bi bi-check-circle me-2"></i>${escHtml(res.message)}
        ${res.data?.errors?.length ? `<ul class="mb-0 mt-2 small">${res.data.errors.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul>` : ''}
      </div>`;
    showToast(res.message, 'success');
    loadStats();
  } else {
    resultDiv.innerHTML = `<div class="alert alert-danger py-2"><i class="bi bi-x-circle me-2"></i>${escHtml(res.message)}</div>`;
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-check2-circle me-2"></i>İçe Aktar';
}

function downloadTemplate() {
  const csv = `name,stock,expiry_date,category,barcode,image_url
Sütlaç 200g,50,2026-04-15,Gıda,8690810010082,
Cola 1L,30,2026-06-01,İçecek,8699504011765,
Çamaşır Suyu,20,2027-01-10,Temizlik,,
Aspirin 500mg,100,2026-12-31,Eczane,8699502070023,`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'urun_sablonu.csv';
  a.click();
  URL.revokeObjectURL(url);
}


// ─────────────────────────────────────────────
// Toast bildirimleri
// ─────────────────────────────────────────────

function showToast(message, type = 'info') {
  const toastEl  = document.getElementById('appToast');
  const toastMsg = document.getElementById('toastMessage');

  toastEl.className = `toast align-items-center border-0 toast-${type}`;
  toastMsg.textContent = message;

  const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 });
  toast.show();
}


// ─────────────────────────────────────────────
// Güvenlik: HTML escape
// ─────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// ─────────────────────────────────────────────
// Sidebar navigasyon event'leri
// ─────────────────────────────────────────────

document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigate(link.dataset.section);
  });
});


// ─────────────────────────────────────────────
// Sayfa ilk yüklendiğinde
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  navigate('dashboard');

  // Her 60 saniyede stats otomatik güncelle
  setInterval(() => {
    const activeSec = document.querySelector('[id^="section"]:not(.d-none)');
    if (activeSec?.id === 'sectionDashboard') {
      loadStats();
      loadDashboardProducts();
    }
  }, 60_000);
});
