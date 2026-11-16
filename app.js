const $ = id => document.getElementById(id);
async function request(url, options) {
  const r = await fetch(url, options); const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "অনুরোধ সম্পন্ন হয়নি"); return data;
}
async function init() {
  try {
    const s = await request("/api/status");
    if (!s.configured) $("status").textContent = "সার্ভার প্রস্তুত নয় — আগে .env সেটআপ করতে হবে।";
    else $("status").textContent = s.connected ? "TikTok অ্যাকাউন্ট সংযুক্ত আছে।" : "এখনও কোনো TikTok অ্যাকাউন্ট সংযুক্ত নেই।";
    if (s.connected) {
      $("connectPanel").classList.add("hidden"); $("profilePanel").classList.remove("hidden");
      const me = await request("/api/me");
      $("avatar").src = me.avatar_url || ""; $("displayName").textContent = me.display_name || "TikTok user";
      $("openId").textContent = "TikTok Open ID: " + me.open_id;
    }
  } catch(e) { $("status").textContent = e.message; }
}
$("loadVideos").addEventListener("click", async () => {
  $("videosPanel").classList.remove("hidden"); $("videos").textContent = "লোড হচ্ছে…";
  try {
    const data = await request("/api/videos");
    const items = data.videos || [];
    $("videos").innerHTML = items.length ? items.map(v => `<article class="video">
      <img src="${safe(v.cover_image_url)}" alt=""><div><b>${safe(v.title || v.video_description || "TikTok video")}</b>
      <div class="metrics">Views: ${v.view_count ?? "—"} · Likes: ${v.like_count ?? "—"} · Comments: ${v.comment_count ?? "—"} · Shares: ${v.share_count ?? "—"}</div>
      ${v.share_url ? `<a href="${safe(v.share_url)}" target="_blank" rel="noopener">ভিডিও খুলুন</a>` : ""}</div></article>`).join("") : "কোনো ভিডিও পাওয়া যায়নি।";
  } catch(e) { $("videos").textContent = e.message; }
});
function safe(v="") { return String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
$("disconnect").addEventListener("click", async () => {
  if (!confirm("এই সার্ভার থেকে TikTok অ্যাকাউন্ট বিচ্ছিন্ন করবেন?")) return;
  await request("/api/disconnect", {method:"POST"}); location.reload();
});
init();