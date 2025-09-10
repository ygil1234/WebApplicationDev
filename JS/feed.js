// JS/feed.js
document.addEventListener("DOMContentLoaded", () => {
    const PROFILES = [
      { id: 1, name: "Chucha",   avatar: "IMG/profile1.jpg" },
      { id: 2, name: "Schnizel", avatar: "IMG/profile2.jpg" },
      { id: 3, name: "Pilpel",   avatar: "IMG/profile3.jpg" },
      { id: 4, name: "Alex",     avatar: "IMG/profile4.jpg" },
      { id: 5, name: "Sasha",    avatar: "IMG/profile5.jpg" },
    ];
  
    const selectedIdStr = localStorage.getItem("selectedProfileId");
    const selectedId = selectedIdStr ? Number(selectedIdStr) : NaN;
    if (!selectedId || Number.isNaN(selectedId)) {
      window.location.href = "profiles.html";
      return;
    }

    const current = PROFILES.find(p => p.id === selectedId);
    if (!current) {
      localStorage.removeItem("selectedProfileId");
      window.location.href = "profiles.html";
      return;
    }
 
    const greetEl = document.getElementById("greet");
    if (greetEl) {
      greetEl.textContent = `${current.name}, שלום`;
    }
  
    const avatarEl = document.getElementById("navAvatar");
    if (avatarEl) {
      avatarEl.src = current.avatar;
      avatarEl.alt = `${current.name} – Profile`;
    }

    document.getElementById("logoutLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.clear();
      window.location.href = "login.html";
    });
  });
  