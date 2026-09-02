const useCases = [
  ["Fuel intelligence", "Konsumsi, rasio, anomali pengisian, unit, shift, dan potensi kehilangan margin."],
  ["Production gap", "Target versus aktual, sumber kehilangan produksi, dan opportunity loss."],
  ["Fleet performance", "Fleet balance, cycle time, antrean, dispatch, dan utilisasi unit."],
  ["Equipment reliability", "Recurring breakdown, downtime, availability, dan dampak produksi."],
  ["Cost per BCM/ton", "Hubungan volume dengan fuel, manpower, equipment, dan maintenance."],
  ["Action effectiveness", "Temuan, keputusan, PIC, tindakan, serta hasil yang benar-benar terukur."],
];

const stages = ["Connect", "Detect", "Explain", "Quantify", "Decide", "Act", "Measure"];

export default function Home() {
  return (
    <main>
      <header className="nav-shell">
        <a className="brand" href="#top" aria-label="MEI home">
          <span><strong>MEI</strong><small>Mining Executive Intelligence</small></span>
        </a>
        <nav aria-label="Navigasi utama">
          <a href="#masalah">Masalah</a><a href="#cara-kerja">Cara kerja</a><a href="#solusi">Solusi</a><a href="#simulasi">Simulasi</a><a href="/telemetry">Telemetry Demo</a>
        </nav>
        <a className="button button-small" href="#kontak">Diskusikan masalah</a>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Mine Performance &amp; Decision Intelligence</p>
            <h1>Dari data operasional site menjadi <em>keputusan manajemen.</em></h1>
            <p className="hero-lead">MEI membantu pemilik kontraktor tambang dan manajemen operasional mengubah data produksi, fleet, fuel, equipment, serta biaya menjadi temuan, evidence, prioritas tindakan, dan hasil terukur.</p>
            <div className="hero-actions"><a className="button" href="#kontak">Diskusikan satu masalah operasional</a><a className="text-link" href="/telemetry">Lihat Telemetry Demo <span>→</span></a></div>
            <div className="trust-line"><span>FMS-agnostic</span><span>Excel-first</span><span>Human-validated</span></div>
          </div>
          <div className="signal-panel" aria-label="Contoh executive intelligence">
            <div className="panel-top"><span>Executive signal</span><b>Site Alpha · Shift malam</b></div>
            <div className="signal-alert"><div className="alert-icon">!</div><div><small>PRIORITAS TINGGI</small><h2>Fuel ratio memburuk</h2><p>Produksi −7,4% · Deviasi fuel terdeteksi</p></div></div>
            <div className="metric-grid"><div><small>Target</small><strong>9.600</strong><span>BCM/hari</span></div><div><small>Aktual</small><strong>8.893</strong><span>BCM/hari</span></div><div><small>Gap</small><strong className="amber">707</strong><span>BCM</span></div></div>
            <div className="evidence-box"><span>Evidence</span><p>Deviasi terkonsentrasi pada unit dan shift tertentu. Perlu verifikasi idle time, haul road, serta catatan pengisian.</p></div>
            <div className="panel-footer"><span>Deteksi ≠ kesimpulan</span><b>Perlu validasi manusia</b></div>
          </div>
        </div>
      </section>

      <section className="problem-section" id="masalah">
        <div className="section-heading"><p className="eyebrow">Management blind spots</p><h2>Data tersedia. Namun, apakah manajemen telah mendapatkan intelligence yang dibutuhkan?</h2><p>Site dapat terlihat produktif di laporan, tetapi masih menyimpan inefisiensi, kehilangan margin, dan tindakan yang tidak pernah terukur.</p></div>
        <div className="problem-grid">
          <article><span>01</span><h3>Produksi tercapai, biaya per BCM meningkat</h3><p>Volume bertambah belum tentu menghasilkan margin yang lebih sehat.</p></article>
          <article><span>02</span><h3>Fuel naik, produksi tidak bertambah sebanding</h3><p>Anomali perlu dijelaskan melalui unit, shift, kondisi jalan, idle time, dan evidence pengisian.</p></article>
          <article><span>03</span><h3>Equipment tersedia, output tetap rendah</h3><p>Physical availability belum menjamin utilisasi dan produktivitas yang optimal.</p></article>
          <article><span>04</span><h3>Masalah yang sama terus kembali</h3><p>Corrective action selesai secara administratif, tetapi dampaknya tidak pernah dibuktikan.</p></article>
        </div>
      </section>

      <section className="field-visual field-visual-hauling" aria-label="Operasi hauling tambang terbuka">
        <div className="field-caption"><p className="eyebrow">Operational reality</p><h2>Satu perubahan di lapangan dapat mengubah produksi, fuel, cycle time, dan biaya secara bersamaan.</h2><p>MEI membantu manajemen melihat hubungan antarindikator—bukan membaca setiap laporan secara terpisah.</p></div>
      </section>

      <section className="process-section" id="cara-kerja">
        <div className="section-heading light"><p className="eyebrow">Closed-loop intelligence</p><h2>Bukan sekadar melihat indikator. MEI menghubungkan data dengan tindakan dan hasil.</h2></div>
        <div className="stage-row">{stages.map((stage, index) => <div className="stage" key={stage}><span>{String(index + 1).padStart(2, "0")}</span><b>{stage}</b></div>)}</div>
        <div className="process-note"><strong>Target → Aktual → Deviasi → Evidence → Dampak → Keputusan → Tindakan → Hasil</strong><p>Setiap temuan penting dapat ditelusuri kembali ke periode, site, unit, shift, formula, dan asumsi yang digunakan.</p></div>
      </section>

      <section className="usecase-section">
        <div className="section-heading split-heading"><div><p className="eyebrow">High-value intelligence</p><h2>Fokus pada masalah operasional yang paling bernilai.</h2></div><p>Mulai sempit, buktikan manfaatnya, lalu perluas use case setelah hasilnya terukur.</p></div>
        <div className="usecase-grid">{useCases.map(([title, copy], index) => <article key={title}><span>{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className="field-visual field-visual-equipment" aria-label="Excavator memuat dump truck di tambang terbuka">
        <div className="field-caption field-caption-right"><p className="eyebrow">Fleet &amp; equipment intelligence</p><h2>Availability belum tentu produktivitas.</h2><p>MEI menghubungkan kondisi unit, utilisasi, cycle time, downtime, dan output agar keputusan penambahan atau perbaikan armada memiliki dasar yang jelas.</p></div>
      </section>

      <section className="readiness-section" id="solusi">
        <div className="section-heading"><p className="eyebrow">Mulai dari kondisi saat ini</p><h2>Satu tujuan, tiga jalur implementasi.</h2><p>MEI tidak memaksa perusahaan mengganti sistem pada hari pertama. Pendekatan disesuaikan dengan kesiapan digital dan data yang tersedia.</p></div>
        <div className="readiness-grid">
          <article><div className="status">01 · Sudah memiliki FMS</div><h3>Integrasikan sistem yang tersedia</h3><p>MEI menggunakan API, database, export, atau sumber data di belakang Power BI.</p><small>FMS existing → MEI intelligence layer</small></article>
          <article className="featured"><div className="status">02 · Data sudah tersedia</div><h3>Mulai tanpa integrasi besar</h3><p>Excel, CSV, Google Sheets, ERP, sistem fuel, GPS, dan laporan site dapat menjadi titik awal.</p><small>Existing data → Data readiness → MEI</small></article>
          <article><div className="status">03 · Belum memiliki FMS</div><h3>Bangun fondasi bersama Faztrack</h3><p>Faztrack Mining Technology menyediakan solusi FMS modular sesuai skala, infrastruktur, dan kebutuhan kontrol.</p><small>Faztrack FMS → MEI intelligence layer</small></article>
        </div>
      </section>

      <section className="clarity-section">
        <div className="clarity-card"><div><p className="eyebrow">Responsible intelligence</p><h2>Hipotesis bukan fakta. Anomali bukan otomatis fraud.</h2></div><div className="clarity-list"><p><b>Fakta</b><span>Terlihat langsung pada data.</span></p><p><b>Deteksi</b><span>Pola atau deviasi yang ditemukan sistem.</span></p><p><b>Hipotesis</b><span>Kemungkinan penyebab yang perlu diverifikasi.</span></p><p><b>Keputusan</b><span>Pilihan yang ditetapkan manusia.</span></p><p><b>Hasil</b><span>Perubahan setelah tindakan dilakukan.</span></p></div></div>
      </section>

      <section className="simulation-section" id="simulasi">
        <div className="section-heading split-heading"><div><p className="eyebrow">Simulasi berbasis data sintetis</p><h2>Ketika kondisi haul road memengaruhi produksi.</h2></div><p>Contoh demonstratif bagaimana temuan dihubungkan dengan dampak, tindakan, dan hasil.</p></div>
        <div className="simulation-card"><div className="sim-stats"><div><small>Target produksi</small><strong>9.600</strong><span>BCM</span></div><div><small>Produksi aktual</small><strong>8.834</strong><span>BCM</span></div><div><small>Production gap</small><strong className="amber">766</strong><span>BCM</span></div></div><div className="sim-flow"><div><small>TEMUAN</small><b>Haul road deterioration</b><p>Kondisi jalan menurunkan produktivitas dan meningkatkan exposure.</p></div><span>→</span><div><small>TINDAKAN</small><b>Road grading</b><p>Corrective action diterima dan dilaksanakan.</p></div><span>→</span><div><small>HASIL SIMULASI</small><b>280 BCM dipulihkan</b><p>45 liter fuel saving · Rp12,6 juta dampak finansial.</p></div></div><p className="disclaimer">Angka menggunakan data sintetis untuk demonstrasi kapabilitas MEI, bukan hasil aktual klien.</p></div>
      </section>

      <section className="cta-section" id="kontak">
        <p className="eyebrow">Start with one high-value problem</p><h2>Jangan mulai dari teknologi.<br/>Mulailah dari masalah operasional yang paling bernilai.</h2><p>Perusahaan tidak harus mengganti seluruh sistem atau menunggu data menjadi sempurna. Mulai dari satu masalah, uji dengan data yang tersedia, lalu ukur manfaatnya.</p>
        <div className="hero-actions centered"><a className="button button-light" href="/telemetry">Buka Telemetry Demo</a><a className="text-link light-link" href="#top">Kembali ke atas <span>→</span></a></div>
      </section>
      <footer><div className="brand footer-brand"><span><strong>MEI</strong><small>Mining Executive Intelligence</small></span></div><p>Mine Performance &amp; Decision Intelligence</p><p>Powered by Faztrack Mining Technology · Faztrack Consulting</p></footer>
    </main>
  );
}
