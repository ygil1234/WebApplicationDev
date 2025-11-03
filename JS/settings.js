// JS/settings.js

document.addEventListener("DOMContentLoaded", () => {
    // Authentication check - only logged-in users can access
    const loggedInUser = sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser');
    if (!loggedInUser) {
        window.location.href = 'login.html';
        return;
    }

    // DOM elements
    const addProfileForm = document.getElementById('addProfileForm');
    const profileNameInput = document.getElementById('profileName');
    const profileNameError = document.getElementById('profileNameError');
    const avatarGrid = document.getElementById('avatarGrid');
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const successMessage = document.getElementById('successMessage');
    const existingProfilesSection = document.getElementById('existingProfilesSection');
    const profilesList = document.getElementById('profilesList');

    // Edit modal elements
    const editProfileModal = new bootstrap.Modal(document.getElementById('editProfileModal'));
    const editProfileForm = document.getElementById('editProfileForm');
    const editProfileIdInput = document.getElementById('editProfileId');
    const editProfileNameInput = document.getElementById('editProfileName');
    const editProfileNameError = document.getElementById('editProfileNameError');
    const editAvatarGrid = document.getElementById('editAvatarGrid');
    const updateProfileBtn = document.getElementById('updateProfileBtn');

    let selectedAvatar = 'IMG/profile1.jpg'; // Default selection
    let editSelectedAvatar = 'IMG/profile1.jpg';

    // ======= Charts state (added) =======
    const dailyViewsHint = document.getElementById('dailyViewsHint');
    const genrePieHint = document.getElementById('genrePieHint');
    let dailyViewsChart = null;
    let genrePieChart = null;
    let profilesCache = []; // used to map profile names when needed

    // Chart settings
    const statsSection = document.querySelector('.settings-stats');
    const chartComputed = statsSection ? window.getComputedStyle(statsSection) : null;
    const chartTextColorRaw = chartComputed?.getPropertyValue('--chart-text-color');
    const chartGridColorRaw = chartComputed?.getPropertyValue('--chart-grid-color');
    const chartLegendColorRaw = chartComputed?.getPropertyValue('--chart-legend-color');
    const chartTextColor = chartTextColorRaw ? chartTextColorRaw.trim() : '#e5e5e5';
    const chartGridColor = chartGridColorRaw ? chartGridColorRaw.trim() : 'rgba(255, 255, 255, 0.08)';
    const chartLegendColor = chartLegendColorRaw ? chartLegendColorRaw.trim() : chartTextColor;
    const chartBgOpacityRaw = Number.parseFloat(chartComputed?.getPropertyValue('--chart-bg-opacity'));
    const chartBorderOpacityRaw = Number.parseFloat(chartComputed?.getPropertyValue('--chart-border-opacity'));
    const chartBgOpacity = Number.isFinite(chartBgOpacityRaw) ? chartBgOpacityRaw : 0.65;
    const chartBorderOpacity = Number.isFinite(chartBorderOpacityRaw) ? chartBorderOpacityRaw : 1;

    // Avatar selection handling for ADD form
    const avatarOptions = avatarGrid.querySelectorAll('.avatar-option');
    avatarOptions.forEach(option => {
        option.addEventListener('click', () => {
            avatarOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            selectedAvatar = option.getAttribute('data-avatar');
        });
    });

    // Select first avatar by default
    avatarOptions[0].classList.add('selected');

    // Avatar selection handling for EDIT modal
    const editAvatarOptions = editAvatarGrid.querySelectorAll('.avatar-option');
    editAvatarOptions.forEach(option => {
        option.addEventListener('click', () => {
            editAvatarOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            editSelectedAvatar = option.getAttribute('data-avatar');
        });
    });

    // Load existing profiles
    async function loadProfiles() {
        try {
            const response = await fetch(`/api/profiles?userId=${encodeURIComponent(loggedInUser)}`);
            
            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = 'login.html';
                    return;
                }
                throw new Error('Failed to load profiles');
            }

            const profiles = await response.json();
            profilesCache = Array.isArray(profiles) ? profiles : [];
            displayProfiles(profilesCache);
        } catch (error) {
            console.error('Error loading profiles:', error);
        }
    }

    function displayProfiles(profiles) {
        if (profiles.length === 0) {
            existingProfilesSection.style.display = 'none';
            return;
        }

        existingProfilesSection.style.display = 'block';
        profilesList.innerHTML = '';

        profiles.forEach(profile => {
            const profileCard = document.createElement('div');
            profileCard.className = 'profile-card';
            profileCard.innerHTML = `
                <div class="profile-card-avatar">
                    <img src="${profile.avatar}" alt="${profile.name}">
                </div>
                <div class="profile-card-info">
                    <div class="profile-card-name">${profile.name}</div>
                </div>
                <div class="profile-card-actions">
                    <button class="profile-btn profile-btn-edit" data-id="${profile.id}" title="Edit">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="profile-btn profile-btn-delete" data-id="${profile.id}" title="Delete">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            `;
            
            profilesList.appendChild(profileCard);
        });

        // Add event listeners for edit and delete buttons
        document.querySelectorAll('.profile-btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const profileId = btn.getAttribute('data-id');
                const profile = profiles.find(p => p.id === profileId);
                if (profile) openEditModal(profile);
            });
        });

        document.querySelectorAll('.profile-btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const profileId = btn.getAttribute('data-id');
                await deleteProfile(profileId);
            });
        });
    }

    // Open edit modal with profile data
    function openEditModal(profile) {
        editProfileIdInput.value = profile.id;
        editProfileNameInput.value = profile.name;
        editSelectedAvatar = profile.avatar;

        // Clear previous selection
        editAvatarOptions.forEach(opt => opt.classList.remove('selected'));
        
        // Select the current avatar
        const currentAvatarOption = Array.from(editAvatarOptions).find(
            opt => opt.getAttribute('data-avatar') === profile.avatar
        );
        if (currentAvatarOption) {
            currentAvatarOption.classList.add('selected');
        }

        // Clear errors
        clearError(editProfileNameInput, editProfileNameError);

        editProfileModal.show();
    }

    // Update profile
    updateProfileBtn.addEventListener('click', async () => {
        const profileId = editProfileIdInput.value;
        const profileName = editProfileNameInput.value.trim();

        // Clear previous messages
        clearError(editProfileNameInput, editProfileNameError);

        // Client-side validation
        if (!profileName || profileName.length < 1) {
            showError(editProfileNameInput, editProfileNameError, 'Please enter a profile name.');
            return;
        }

        if (profileName.length > 20) {
            showError(editProfileNameInput, editProfileNameError, 'Profile name must be maximum 20 characters.');
            return;
        }

        // Disable button during request
        updateProfileBtn.disabled = true;
        updateProfileBtn.textContent = 'Updating...';

        try {
            const response = await fetch(`/api/profiles/${profileId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: loggedInUser,
                    name: profileName,
                    avatar: editSelectedAvatar
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = 'login.html';
                    return;
                }
                throw new Error(data.error || 'Failed to update profile');
            }

            // Success
            editProfileModal.hide();
            await loadProfiles();
            showSuccess('Profile updated successfully!');

            // Refresh charts so name/color updates reflect
            loadStats();

        } catch (error) {
            console.error('Error updating profile:', error);
            showError(editProfileNameInput, editProfileNameError, error.message || 'Failed to update profile. Please try again.');
        } finally {
            updateProfileBtn.disabled = false;
            updateProfileBtn.textContent = 'Update';
        }
    });

    // Delete profile
    async function deleteProfile(profileId) {
        try {
            const response = await fetch(`/api/profiles/${profileId}`, {
                method: 'DELETE',
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = 'login.html';
                    return;
                }
                throw new Error(data.error || 'Failed to delete profile');
            }

            // Success - reload profiles
            await loadProfiles();
            showSuccess('Profile deleted successfully!');

            // Refresh charts
            loadStats();

        } catch (error) {
            console.error('Error deleting profile:', error);
            alert(error.message || 'Failed to delete profile. Please try again.');
        }
    }

    // Form submission handling for ADD
    addProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const profileName = profileNameInput.value.trim();

        // Clear previous messages
        clearError(profileNameInput, profileNameError);
        successMessage.textContent = '';
        successMessage.classList.add('d-none');

        // Client-side validation
        if (!profileName || profileName.length < 1) {
            showError(profileNameInput, profileNameError, 'Please enter a profile name.');
            return;
        }

        if (profileName.length > 20) {
            showError(profileNameInput, profileNameError, 'Profile name must be maximum 20 characters.');
            return;
        }

        // Disable button during request
        saveProfileBtn.disabled = true;
        saveProfileBtn.textContent = 'Creating...';

        try {
            // Send POST request to server
            const response = await fetch('/api/profiles', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: loggedInUser,
                    name: profileName,
                    avatar: selectedAvatar
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = 'login.html';
                    return;
                }
                throw new Error(data.error || 'Failed to create profile');
            }

            // Success
            showSuccess('Profile created successfully!');
            
            // Clear form
            profileNameInput.value = '';
            avatarOptions.forEach(opt => opt.classList.remove('selected'));
            avatarOptions[0].classList.add('selected');
            selectedAvatar = 'IMG/profile1.jpg';

            // Reload profiles list & charts
            await loadProfiles();
            loadStats();

        } catch (error) {
            console.error('Error creating profile:', error);
            showError(profileNameInput, profileNameError, error.message || 'Failed to create profile. Please try again.');
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = 'Save';
        }
    });

    // Helper functions
    function showError(inputElement, errorElement, message) {
        inputElement.classList.add('login-input-error');
        errorElement.textContent = message;
        errorElement.classList.remove('d-none');
    }

    function clearError(inputElement, errorElement) {
        inputElement.classList.remove('login-input-error');
        errorElement.textContent = '';
        errorElement.classList.add('d-none');
    }

    function showSuccess(message) {
        successMessage.textContent = message;
        successMessage.classList.remove('d-none');
        
        // Hide after 3 seconds
        setTimeout(() => {
            successMessage.classList.add('d-none');
        }, 3000);
    }
    
    // Statistics 

    async function loadStats() {
        // Clear hints
        dailyViewsHint.textContent = '';
        genrePieHint.textContent = '';

        const userId = encodeURIComponent(loggedInUser);
        try {
            const [dailyRes, genreRes] = await Promise.all([
                // Expected shape option A (records):
                // [{date:'YYYY-MM-DD', profileId:'...', profileName:'Alice', views:3}, ...]
                // Option B (series):
                // { days: ['YYYY-MM-DD', ...], series: [{profileId, profileName, data:[..]}] }
                fetch(`/api/stats/daily-views?userId=${userId}&days=7`),
                // Expected shape: [{genre:'Action', views:40}, ...]
                fetch(`/api/stats/genre-popularity?userId=${userId}`)
            ]);

            if (dailyRes.status === 401 || genreRes.status === 401) {
                window.location.href = 'login.html';
                return;
            }

            const [dailyData, genreData] = await Promise.all([dailyRes.json(), genreRes.json()]);

            renderDailyViewsChart(dailyData);
            renderGenrePieChart(genreData);
        } catch (err) {
            console.error('Failed to load statistics:', err);
            dailyViewsHint.textContent = 'Unable to load daily views.';
            genrePieHint.textContent = 'Unable to load genre popularity.';
        }
    }

    function renderDailyViewsChart(raw) {
        const ctx = document.getElementById('dailyViewsChart');
        if (!ctx || typeof Chart === 'undefined') return;

        // Normalize to a single dataset with profiles on the X-axis
        let labels = [];
        let values = [];

        if (raw && Array.isArray(raw.profiles)) {
            labels = raw.profiles.map(p => p.profileName || findProfileName(p.profileId) || 'Unknown');
            values = raw.profiles.map(p => Number(p.views || 0));
        } else if (Array.isArray(raw)) {
            // Fallback for legacy array payloads
            const totals = new Map();
            raw.forEach(item => {
                if (!item) return;
                const key = item.profileId || item.profileName || 'Unknown';
                const label = item.profileName || findProfileName(item.profileId) || key;
                totals.set(key, {
                    label,
                    views: (totals.get(key)?.views || 0) + Number(item.views || 0)
                });
            });
            const aggregated = Array.from(totals.values());
            labels = aggregated.map(entry => entry.label);
            values = aggregated.map(entry => entry.views);
        }

        const totalViews = values.reduce((sum, val) => sum + val, 0);
        dailyViewsHint.textContent = totalViews === 0
            ? 'No views recorded for the selected period.'
            : '';

        if (dailyViewsChart) {
            dailyViewsChart.destroy();
        }

        const colors = labels.map((_, idx) => colorForIndex(idx, chartBgOpacity));
        const borderColors = labels.map((_, idx) => colorForIndex(idx, chartBorderOpacity));

        dailyViewsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Views (last 7 days)',
                    data: values,
                    backgroundColor: colors,
                    borderColor: borderColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: chartLegendColor } },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    x: {
                        stacked: false,
                        ticks: { color: chartTextColor },
                        grid: { color: chartGridColor }
                    },
                    y: {
                        stacked: false,
                        beginAtZero: true,
                        ticks: {
                            color: chartTextColor,
                            stepSize: 1,
                            callback: (value) => Number.isFinite(value) ? Math.round(value) : value
                        },
                        grid: { color: chartGridColor }
                    }
                }
            }
        });
    }

    function renderGenrePieChart(raw) {
        const ctx = document.getElementById('genrePieChart');
        if (!ctx || typeof Chart === 'undefined') return;

        const labels = [];
        const data = [];
        if (Array.isArray(raw)) {
            raw.forEach(r => {
                if (!r) return;
                labels.push(r.genre || 'Unknown');
                data.push(Number(r.views || r.count || 0));
            });
        }

        const total = data.reduce((a, v) => a + v, 0);
        if (total === 0) {
            genrePieHint.textContent = 'No popularity data available.';
        } else {
            genrePieHint.textContent = '';
        }

        const colors = labels.map((_, i) => colorForIndex(i, chartBgOpacity));
        const borderColors = labels.map((_, i) => colorForIndex(i, chartBorderOpacity));

        if (genrePieChart) {
            genrePieChart.destroy();
        }

        genrePieChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderColor: borderColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: chartLegendColor } },
                    tooltip: { callbacks: {
                        label: (ctx) => {
                            const v = ctx.parsed || 0;
                            const pct = total ? Math.round((v / total) * 100) : 0;
                            return `${ctx.label}: ${v} (${pct}%)`;
                        }
                    }}
                }
            }
        });
    }

    function findProfileName(profileId) {
        const p = profilesCache.find(x => x.id === profileId);
        return p?.name || null;
    }

    // Simple, consistent color generator (HSL -> rgba)
    function colorForIndex(i, alpha = 1) {
        const hue = (i * 57) % 360; // spread nicely
        return `rgba(${hslToRgb(hue / 360, 0.62, 0.52).join(', ')}, ${alpha})`;
    }
    function hslToRgb(h, s, l) {
        // returns [r,g,b] 0-255
        let r, g, b;
        if (s === 0) { r = g = b = l; }
        else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    // Initial load of profiles & stats
    loadProfiles();
    loadStats();
});
