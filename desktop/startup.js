'use strict';
const button = document.querySelector('#start');
const retry = document.querySelector('#retry');
const message = document.querySelector('#message');
async function check() {
  button.disabled = true; retry.disabled = true;
  message.textContent = 'Memeriksa perangkat lokal…';
  try {
    const state = await window.flowDesktop.check();
    document.querySelector('#chrome').textContent = state.chrome
      ? '✓ Google Chrome ditemukan.' : 'Google Chrome belum ditemukan. Instal Chrome atau atur FLOW_MCP_CHROME ke lokasi chrome.exe, lalu buka ulang aplikasi.';
    document.querySelector('#ffmpeg').textContent = state.ffmpeg && state.ffprobe
      ? '✓ FFmpeg dan ffprobe tersedia.' : 'FFmpeg/ffprobe belum lengkap (opsional). Fitur penggabungan dan pemrosesan video memerlukannya. Instal dengan: winget install Gyan.FFmpeg, lalu buka ulang aplikasi.';
    button.disabled = !state.chrome;
    message.textContent = state.chrome ? 'Siap membuka Studio.' : 'Chrome diperlukan untuk melanjutkan.';
  } catch { message.textContent = 'Pemeriksaan gagal. Tutup lalu buka ulang aplikasi.'; }
  retry.disabled = false;
}
button.addEventListener('click', async () => {
  button.disabled = true; retry.disabled = true;
  message.textContent = 'Menyiapkan backend localhost. Harap tunggu…';
  try {
    const result = await window.flowDesktop.start();
    if (result.error) { message.textContent = result.error; button.disabled = false; retry.disabled = false; }
  } catch { message.textContent = 'Studio gagal dibuka. Tutup lalu buka ulang aplikasi.'; retry.disabled = false; }
});
retry.addEventListener('click', check);
check();
