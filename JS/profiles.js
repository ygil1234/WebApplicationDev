document.addEventListener("DOMContentLoaded", () => {
  // Demo list of profiles
  const PROFILES = [
    { id: 1, name: "Chucha",   avatar: "IMG/profile1.jpg" },
    { id: 2, name: "Schnizel", avatar: "IMG/profile2.jpg" },
    { id: 3, name: "Pilpel",   avatar: "IMG/profile3.jpg" },
    { id: 4, name: "Alex",     avatar: "IMG/profile4.jpg" },
    { id: 5, name: "Sasha",    avatar: "IMG/profile5.jpg" },
  ];

  // Generate profile items
  document.querySelectorAll(".profile-item").forEach((item, index) => {
    item.addEventListener("click", () => {
      const profile = PROFILES[index];
      if (!profile) return;
      localStorage.setItem("selectedProfileId", String(profile.id));
      window.location.href = "feed.html";
    });
  });
});
