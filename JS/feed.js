document.addEventListener("DOMContentLoaded", () => {
  // ---------- פרופילים (דמו) ----------
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

  const logoutLink = document.getElementById("logoutLink");
  if (logoutLink) {
    logoutLink.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.clear();
      window.location.href = "login.html";
    });
  }

  const CATALOG = [
    { id: "m7",  title: "The Godfather",               year: 1972, genres: ["Crime","Drama"],         likes: 5400, cover: "IMG/feed/godfather.jpg",          type: "Movie" },
    { id: "m8",  title: "The Godfather Part II",       year: 1974, genres: ["Crime","Drama"],         likes: 4600, cover: "IMG/feed/godfather2.jpg",         type: "Movie" },
    { id: "m9",  title: "The Shawshank Redemption",    year: 1994, genres: ["Drama"],                 likes: 6200, cover: "IMG/feed/shawshank.jpg",          type: "Movie" },
    { id: "m10", title: "Pulp Fiction",                year: 1994, genres: ["Crime","Drama"],         likes: 5100, cover: "IMG/feed/pulpfiction.jpg",        type: "Movie" },
    { id: "m11", title: "The Dark Knight",             year: 2008, genres: ["Action","Crime"],        likes: 7000, cover: "IMG/feed/thedarlknight.jpg",      type: "Movie" },
    { id: "m12", title: "Schindler's List",            year: 1993, genres: ["Biography","Drama","History"], likes: 4300, cover: "IMG/feed/schindlerlist.jpg", type: "Movie" },
    { id: "m13", title: "Fight Club",                  year: 1999, genres: ["Drama","Thriller"],      likes: 3900, cover: "IMG/feed/fightclub.jpg",          type: "Movie" },
    { id: "m14", title: "Forrest Gump",                year: 1994, genres: ["Drama","Romance"],       likes: 4800, cover: "IMG/feed/forrestgump.jpg",        type: "Movie" },
    { id: "m15", title: "The Matrix",                  year: 1999, genres: ["Sci-Fi","Action"],       likes: 5200, cover: "IMG/feed/thematrix.jpg",          type: "Movie" },
    { id: "m16", title: "Star Wars: A New Hope",       year: 1977, genres: ["Sci-Fi","Adventure"],    likes: 5600, cover: "IMG/feed/starwars.jpg",           type: "Movie" },
    { id: "m17", title: "The Empire Strikes Back",     year: 1980, genres: ["Sci-Fi","Adventure"],    likes: 5300, cover: "IMG/feed/starwars5.jpg",          type: "Movie" },
    { id: "m18", title: "Back to the Future",          year: 1985, genres: ["Adventure","Sci-Fi"],    likes: 3600, cover: "IMG/feed/backtothefuture.jpg",    type: "Movie" },
    { id: "m19", title: "Titanic",                     year: 1997, genres: ["Romance","Drama"],       likes: 4700, cover: "IMG/feed/titanic.jpg",            type: "Movie" },
    { id: "m20", title: "Jurassic Park",               year: 1993, genres: ["Adventure","Sci-Fi"],    likes: 3900, cover: "IMG/feed/jurassicpark.jpg",       type: "Movie" },
    { id: "m21", title: "Casablanca",                  year: 1942, genres: ["Romance","Drama"],       likes: 3200, cover: "IMG/feed/casablanca.jpg",         type: "Movie" },
    { id: "m22", title: "Citizen Kane",                year: 1941, genres: ["Drama","Mystery"],       likes: 2800, cover: "IMG/feed/citizenkane.jpg",        type: "Movie" },
    { id: "m23", title: "Psycho",                      year: 1960, genres: ["Horror","Thriller"],     likes: 3000, cover: "IMG/feed/psycho.jpg",             type: "Movie" },
    { id: "m24", title: "The Wizard of Oz",            year: 1939, genres: ["Fantasy","Family"],      likes: 3100, cover: "IMG/feed/wizardofoz.jpg",         type: "Movie" },
    { id: "m25", title: "LOTR: The Fellowship of the Ring", year: 2001, genres: ["Adventure","Fantasy"], likes: 5200, cover: "IMG/feed/lotr1.jpg",          type: "Movie" },
    { id: "m26", title: "Goodfellas",                  year: 1990, genres: ["Crime","Drama"],         likes: 3500, cover: "IMG/feed/goodfellas.jpg",         type: "Movie" },
    { id: "m27", title: "Seven Samurai",               year: 1954, genres: ["Action","Adventure","Drama"], likes: 2600, cover: "IMG/feed/sevensamurai.jpg", type: "Movie" },
    { id: "m28", title: "Spirited Away",               year: 2001, genres: ["Animation","Fantasy","Adventure"], likes: 3400, cover: "IMG/feed/spiritedaway.jpg", type: "Movie" },
    { id: "m29", title: "The Lion King",               year: 1994, genres: ["Animation","Family"],    likes: 4500, cover: "IMG/feed/lionking.jpg",           type: "Movie" },
    { id: "m30", title: "Apocalypse Now",              year: 1979, genres: ["Drama","War"],           likes: 2900, cover: "IMG/feed/apocalypsenow.jpg",      type: "Movie" },
    { id: "m31", title: "The Silence of the Lambs",    year: 1991, genres: ["Thriller","Crime"],      likes: 3800, cover: "IMG/feed/silenceofthelambs.jpg",  type: "Movie" },

    { id: "s1",  title: "Friends",                    year: 1994, genres: ["Comedy","Romance"],            likes: 7200, cover: "IMG/feed/friends.jpg",        type: "Series" },
    { id: "s2",  title: "The Office (US)",            year: 2005, genres: ["Comedy"],                      likes: 6900, cover: "IMG/feed/theofficeus.jpg",    type: "Series" },
    { id: "s3",  title: "Seinfeld",                   year: 1989, genres: ["Comedy"],                      likes: 6100, cover: "IMG/feed/seinfeld.jpg",       type: "Series" },
    { id: "s4",  title: "The Simpsons",               year: 1989, genres: ["Animation","Comedy","Family"], likes: 6400, cover: "IMG/feed/simpsons.jpg",       type: "Series" },
    { id: "s5",  title: "Breaking Bad",               year: 2008, genres: ["Crime","Drama","Thriller"],    likes: 7800, cover: "IMG/feed/breakingbad.jpg",    type: "Series" },
    { id: "s6",  title: "Game of Thrones",            year: 2011, genres: ["Fantasy","Drama","Adventure"], likes: 7600, cover: "IMG/feed/gameofthrones.jpg",  type: "Series" },
    { id: "s7",  title: "Stranger Things",            year: 2016, genres: ["Sci-Fi","Horror","Drama"],     likes: 7300, cover: "IMG/feed/strangerthings.jpg", type: "Series" },
    { id: "s8",  title: "The Sopranos",               year: 1999, genres: ["Crime","Drama"],               likes: 6200, cover: "IMG/feed/sopranos.jpg",       type: "Series" },
    { id: "s9",  title: "The Wire",                   year: 2002, genres: ["Crime","Drama"],               likes: 5900, cover: "IMG/feed/thewire.jpg",        type: "Series" },
    { id: "s10", title: "Sherlock",                   year: 2010, genres: ["Crime","Mystery","Drama"],     likes: 5600, cover: "IMG/feed/sherlock.jpg",       type: "Series" },
    { id: "s11", title: "House M.D.",                 year: 2004, genres: ["Drama","Medical"],             likes: 5500, cover: "IMG/feed/housemd.jpg",        type: "Series" },
    { id: "s12", title: "Lost",                       year: 2004, genres: ["Drama","Mystery","Sci-Fi"],    likes: 5400, cover: "IMG/feed/lost.jpg",           type: "Series" },
    { id: "s13", title: "Westworld",                  year: 2016, genres: ["Sci-Fi","Drama","Western"],    likes: 4800, cover: "IMG/feed/westworld.jpg",      type: "Series" },
    { id: "s14", title: "True Detective",             year: 2014, genres: ["Crime","Drama","Mystery"],     likes: 5200, cover: "IMG/feed/truedetective.jpg",  type: "Series" },
    { id: "s15", title: "Chernobyl",                  year: 2019, genres: ["Drama","History","Mini-Series"], likes: 5100, cover: "IMG/feed/chernobyl.jpg",    type: "Series" },
    { id: "s16", title: "The Crown",                  year: 2016, genres: ["Drama","History"],             likes: 4700, cover: "IMG/feed/thecrown.jpg",       type: "Series" },
    { id: "s17", title: "Mad Men",                    year: 2007, genres: ["Drama"],                       likes: 5000, cover: "IMG/feed/madmen.jpg",         type: "Series" },
    { id: "s18", title: "How I Met Your Mother",      year: 2005, genres: ["Comedy","Romance"],            likes: 5300, cover: "IMG/feed/himym.jpg",          type: "Series" },
    { id: "s19", title: "The Big Bang Theory",        year: 2007, genres: ["Comedy"],                      likes: 5600, cover: "IMG/feed/bigbangtheory.jpg",  type: "Series" },
    { id: "s20", title: "Avatar: The Last Airbender", year: 2005, genres: ["Animation","Action","Fantasy"],likes: 5800, cover: "IMG/feed/avatar.jpg",         type: "Series" },
    { id: "s21", title: "Rick and Morty",             year: 2013, genres: ["Animation","Sci-Fi","Comedy"], likes: 6000, cover: "IMG/feed/rickandmorty.jpg",  type: "Series" }
  ];

  const hero = document.getElementById("hero");
  const featured = [...CATALOG].sort((a,b)=>b.likes-a.likes)[0];

  if (hero && featured) {
    hero.innerHTML = `
      <div class="nf-hero__bg" style="background-image:url('${featured.cover}')"></div>
<div class="nf-hero__meta" dir="rtl">
<h1 class="nf-hero__title">${featured.title}</h1>
<div class="nf-hero__sub">${featured.year} • ${featured.genres.join(" • ")} • ${featured.type}</div>
<div class="nf-hero__actions">
  <button class="nf-cta nf-cta--play" id="btnPlay">
    <svg viewBox="0 0 24 24" class="nf-cta__icon" aria-hidden="true">
      <path d="M6 4l14 8-14 8z"></path>
    </svg>
    <span>Play</span>
  </button>
  <button class="nf-cta nf-cta--info" id="btnInfo" aria-haspopup="dialog" aria-controls="infoDialog">
    <svg viewBox="0 0 24 24" width="24" height="24" class="nf-cta__icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" role="img">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM0 12C0 5.37258 5.37258 0 12 0C18.6274 0 24 5.37258 24 12C24 18.6274 18.6274 24 12 24C5.37258 24 0 18.6274 0 12ZM13 10V18H11V10H13ZM12 8.5C12.8284 8.5 13.5 7.82843 13.5 7C13.5 6.17157 12.8284 5.5 12 5.5C11.1716 5.5 10.5 6.17157 10.5 7C10.5 7.82843 11.1716 8.5 12 8.5Z" fill="currentColor"></path>
    </svg>
    <span>More Info</span>
  </button>
</div>
</div>

    `;
  }


  /* ===== ROWS ===== */
  const rowsRoot = document.getElementById("rows");
  const FALLBACK = "IMG/feed/placeholder.jpg";

  // דמו "Continue Watching" פר משתמש
  const progressKey = `progress_by_${selectedId}`;
  const progress = JSON.parse(localStorage.getItem(progressKey) || "{}");
  if (!Object.keys(progress).length) {
    CATALOG.slice(0, 8).forEach(i => progress[i.id] = Math.floor(Math.random()*80)+10);
    localStorage.setItem(progressKey, JSON.stringify(progress));
  }

  const byGenre = g => CATALOG.filter(i => i.genres.includes(g));
  const classics = CATALOG.filter(i => i.year <= 1999).sort((a,b)=>b.likes-a.likes).slice(0,12);
  const popular  = [...CATALOG].sort((a,b)=>b.likes-a.likes).slice(0,14);
  const continueWatching = CATALOG.filter(i => progress[i.id] > 0).slice(0,12);

  const ROWS = [
    { id: "row-popular",  title: "Popular on Netflix", items: popular },
    { id: "row-continue", title: `Continue Watching for ${current.name}`, items: continueWatching, withProgress: true },
    { id: "row-sci",      title: "Sci-Fi & Fantasy", items: byGenre("Sci-Fi").concat(byGenre("Fantasy")).slice(0,14) },
    { id: "row-drama",    title: "Critically-acclaimed Drama", items: byGenre("Drama").slice(0,14) },
    { id: "row-classic",  title: "Classics", items: classics }
  ];

  function makeRow({id, title, items, withProgress=false}) {
      const section = document.createElement("section");
      section.className = "nf-row";
      section.innerHTML = `
        <h2 class="nf-row__title">${title}</h2>
        <div class="nf-row__viewport">
          <button class="nf-row__arrow nf-row__arrow--left" aria-label="Scroll left">
            <svg viewBox="0 0 24 24" width="36" height="36" class="nf-icon" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <div class="nf-row__scroller" id="${id}"></div>
          <button class="nf-row__arrow nf-row__arrow--right" aria-label="Scroll right">
            <svg viewBox="0 0 24 24" width="36" height="36" class="nf-icon" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      `;
      const scroller = section.querySelector(".nf-row__scroller");
    
      items.forEach(item => {
        const p = progress[item.id] || 0;
        const card = document.createElement("article");
        card.className = "nf-card";
        card.innerHTML = `
          <div class="nf-card__cover">
            <img src="${item.cover}" alt="${item.title}" loading="lazy"
                 onerror="this.onerror=null;this.src='${FALLBACK}'" />
            ${withProgress ? `<div class="nf-progress"><div class="nf-progress__bar" style="width:${p}%"></div></div>` : ``}
          </div>
        `;
        scroller.appendChild(card);
      });
    
      const left  = section.querySelector(".nf-row__arrow--left");
      const right = section.querySelector(".nf-row__arrow--right");
      const scrollBy = () => Math.max(scroller.clientWidth * 0.88, 320);
      left.addEventListener("click",  () => scroller.scrollBy({ left: -scrollBy(), behavior: "smooth" }));
      right.addEventListener("click", () => scroller.scrollBy({ left:  scrollBy(), behavior: "smooth" }));
    
      return section;
    }
    

  if (rowsRoot) {
    rowsRoot.innerHTML = "";
    ROWS.forEach(r => rowsRoot.appendChild(makeRow(r)));
  }
});
