// JS/settings.js

// Wait for the HTML document to fully load before running any code
document.addEventListener("DOMContentLoaded", () => {
    // Authentication check - make sure user is logged in before accessing this page
    // Check both sessionStorage (temporary) and localStorage (persistent) for logged in user
    const loggedInUser = sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser');
    if (!loggedInUser) {
        // If no user is logged in, redirect them to the login page
        window.location.href = '../login.html';
        return;
    }

    // Get references to all the DOM elements we'll need for the add profile form
    const addProfileForm = document.getElementById('addProfileForm');
    const profileNameInput = document.getElementById('profileName');
    const profileNameError = document.getElementById('profileNameError');
    const avatarGrid = document.getElementById('avatarGrid');
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const successMessage = document.getElementById('successMessage');
    const existingProfilesSection = document.getElementById('existingProfilesSection');
    const profilesList = document.getElementById('profilesList');

    // Get references to edit modal elements and initialize the Bootstrap modal
    const editProfileModal = new bootstrap.Modal(document.getElementById('editProfileModal'));
    const editProfileForm = document.getElementById('editProfileForm');
    const editProfileIdInput = document.getElementById('editProfileId');
    const editProfileNameInput = document.getElementById('editProfileName');
    const editProfileNameError = document.getElementById('editProfileNameError');
    const editAvatarGrid = document.getElementById('editAvatarGrid');
    const updateProfileBtn = document.getElementById('updateProfileBtn');

    // Track which avatar is currently selected for both forms
    let selectedAvatar = 'IMG/profile1.jpg'; // Default avatar for new profiles
    let editSelectedAvatar = 'IMG/profile1.jpg'; // Default avatar for editing

    // Store chart instances and profiles data in memory
    const dailyViewsHint = document.getElementById('dailyViewsHint');
    const genrePieHint = document.getElementById('genrePieHint');
    let dailyViewsChart = null; // Will hold the Chart.js instance for bar chart
    let genrePieChart = null; // Will hold the Chart.js instance for pie chart
    let profilesCache = []; // Cache profiles data to avoid repeated API calls

    // Set up click handlers for avatar selection in the ADD form
    const avatarOptions = avatarGrid.querySelectorAll('.avatar-option');
    avatarOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Remove 'selected' class from all avatars
            avatarOptions.forEach(opt => opt.classList.remove('selected'));
            // Add 'selected' class to the clicked avatar
            option.classList.add('selected');
            // Store the selected avatar path from the data attribute
            selectedAvatar = option.getAttribute('data-avatar');
        });
    });

    // Select the first avatar by default when page loads
    avatarOptions[0].classList.add('selected');

    // Set up click handlers for avatar selection in the EDIT modal
    const editAvatarOptions = editAvatarGrid.querySelectorAll('.avatar-option');
    editAvatarOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Remove selection from all avatars in edit modal
            editAvatarOptions.forEach(opt => opt.classList.remove('selected'));
            // Mark the clicked avatar as selected
            option.classList.add('selected');
            // Update the selected avatar variable
            editSelectedAvatar = option.getAttribute('data-avatar');
        });
    });

    // Function to fetch and display all existing profiles from the server
    async function loadProfiles() {
        try {
            // Make GET request to fetch profiles for the current user
            const response = await fetch(`/api/profiles?userId=${encodeURIComponent(loggedInUser)}`);
            
            if (!response.ok) {
                // If unauthorized (401), redirect to login
                if (response.status === 401) {
                    window.location.href = '../login.html';
                    return;
                }
                throw new Error('Failed to load profiles');
            }

            // Parse the JSON response
            const profiles = await response.json();
            // Store profiles in cache for later use (like in charts)
            profilesCache = Array.isArray(profiles) ? profiles : [];
            // Display the profiles on the page
            displayProfiles(profilesCache);
        } catch (error) {
            console.error('Error loading profiles:', error);
        }
    }

    // Function to render the profiles list in the UI
    function displayProfiles(profiles) {
        // If no profiles exist, hide the entire section
        if (profiles.length === 0) {
            existingProfilesSection.style.display = 'none';
            return;
        }

        // Show the section and clear any existing content
        existingProfilesSection.style.display = 'block';
        profilesList.innerHTML = '';

        // Create a card for each profile
        profiles.forEach(profile => {
            const profileCard = document.createElement('div');
            profileCard.className = 'profile-card';
            // Build the HTML for the profile card with avatar, name, and action buttons
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
            
            // Add the profile card to the list
            profilesList.appendChild(profileCard);
        });

        // Attach event listeners to all edit buttons
        document.querySelectorAll('.profile-btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent event bubbling
                // Get the profile ID from the button's data attribute
                const profileId = btn.getAttribute('data-id');
                // Find the full profile object from our profiles array
                const profile = profiles.find(p => p.id === profileId);
                if (profile) openEditModal(profile);
            });
        });

        // Attach event listeners to all delete buttons
        document.querySelectorAll('.profile-btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent event bubbling
                // Get the profile ID and call delete function
                const profileId = btn.getAttribute('data-id');
                await deleteProfile(profileId);
            });
        });
    }

    // Function to open the edit modal and populate it with profile data
    function openEditModal(profile) {
        // Set the hidden profile ID field
        editProfileIdInput.value = profile.id;
        // Pre-fill the name input with current profile name
        editProfileNameInput.value = profile.name;
        // Set the selected avatar to the profile's current avatar
        editSelectedAvatar = profile.avatar;

        // Clear any previous avatar selections
        editAvatarOptions.forEach(opt => opt.classList.remove('selected'));
        
        // Find and select the avatar that matches the profile's current avatar
        const currentAvatarOption = Array.from(editAvatarOptions).find(
            opt => opt.getAttribute('data-avatar') === profile.avatar
        );
        if (currentAvatarOption) {
            currentAvatarOption.classList.add('selected');
        }

        // Clear any previous error messages
        clearError(editProfileNameInput, editProfileNameError);

        // Show the modal
        editProfileModal.show();
    }

    // Handle the update button click in edit modal
    updateProfileBtn.addEventListener('click', async () => {
        // Get the values from the form
        const profileId = editProfileIdInput.value;
        const profileName = editProfileNameInput.value.trim();

        // Clear any previous error messages
        clearError(editProfileNameInput, editProfileNameError);

        // Validate the profile name - can't be empty
        if (!profileName || profileName.length < 1) {
            showError(editProfileNameInput, editProfileNameError, 'Please enter a profile name.');
            return;
        }

        // Validate the profile name - max 20 characters
        if (profileName.length > 20) {
            showError(editProfileNameInput, editProfileNameError, 'Profile name must be maximum 20 characters.');
            return;
        }

        // Disable the button and show loading state while processing
        updateProfileBtn.disabled = true;
        updateProfileBtn.textContent = 'Updating...';

        try {
            // Send PUT request to update the profile
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
                // Check if session expired
                if (response.status === 401) {
                    window.location.href = '../login.html';
                    return;
                }
                throw new Error(data.error || 'Failed to update profile');
            }

            // Success - close the modal
            editProfileModal.hide();
            // Reload the profiles list to show updated data
            await loadProfiles();
            // Show success message
            showSuccess('Profile updated successfully!');

            // Refresh charts so any name changes are reflected
            loadStats();

        } catch (error) {
            console.error('Error updating profile:', error);
            showError(editProfileNameInput, editProfileNameError, error.message || 'Failed to update profile. Please try again.');
        } finally {
            // Re-enable the button and restore original text
            updateProfileBtn.disabled = false;
            updateProfileBtn.textContent = 'Update';
        }
    });

    // Function to delete a profile
    async function deleteProfile(profileId) {
        try {
            // Send DELETE request to the server
            const response = await fetch(`/api/profiles/${profileId}`, {
                method: 'DELETE',
            });

            const data = await response.json();

            if (!response.ok) {
                // Check if session expired
                if (response.status === 401) {
                    window.location.href = '../login.html';
                    return;
                }
                throw new Error(data.error || 'Failed to delete profile');
            }

            // Success - reload the profiles list
            await loadProfiles();
            showSuccess('Profile deleted successfully!');

            // Refresh charts since we removed a profile
            loadStats();

        } catch (error) {
            console.error('Error deleting profile:', error);
            alert(error.message || 'Failed to delete profile. Please try again.');
        }
    }

    // Handle form submission for adding a new profile
    addProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevent default form submission
        
        // Get the profile name from input
        const profileName = profileNameInput.value.trim();

        // Clear any previous error or success messages
        clearError(profileNameInput, profileNameError);
        successMessage.textContent = '';
        successMessage.classList.add('d-none');

        // Validate profile name - can't be empty
        if (!profileName || profileName.length < 1) {
            showError(profileNameInput, profileNameError, 'Please enter a profile name.');
            return;
        }

        // Validate profile name - max 20 characters
        if (profileName.length > 20) {
            showError(profileNameInput, profileNameError, 'Profile name must be maximum 20 characters.');
            return;
        }

        // Disable button and show loading state
        saveProfileBtn.disabled = true;
        saveProfileBtn.textContent = 'Creating...';

        try {
            // Send POST request to create new profile
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
                // Check if session expired
                if (response.status === 401) {
                    window.location.href = '../login.html';
                    return;
                }
                throw new Error(data.error || 'Failed to create profile');
            }

            // Success - show success message
            showSuccess('Profile created successfully!');
            
            // Reset the form to default state
            profileNameInput.value = '';
            avatarOptions.forEach(opt => opt.classList.remove('selected'));
            avatarOptions[0].classList.add('selected');
            selectedAvatar = 'IMG/profile1.jpg';

            // Reload profiles list and charts
            await loadProfiles();
            loadStats();

        } catch (error) {
            console.error('Error creating profile:', error);
            showError(profileNameInput, profileNameError, error.message || 'Failed to create profile. Please try again.');
        } finally {
            // Re-enable button and restore original text
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = 'Save';
        }
    });

    // Helper function to show error messages on input fields
    function showError(inputElement, errorElement, message) {
        inputElement.classList.add('login-input-error'); // Add red border to input
        errorElement.textContent = message; // Set error message text
        errorElement.classList.remove('d-none'); // Show the error message
    }

    // Helper function to clear error messages from input fields
    function clearError(inputElement, errorElement) {
        inputElement.classList.remove('login-input-error'); // Remove red border
        errorElement.textContent = ''; // Clear error message text
        errorElement.classList.add('d-none'); // Hide the error message
    }

    // Helper function to show success messages
    function showSuccess(message) {
        successMessage.textContent = message;
        successMessage.classList.remove('d-none'); // Show success message
        
        // Automatically hide the message after 3 seconds
        setTimeout(() => {
            successMessage.classList.add('d-none');
        }, 3000);
    }

    // =======================
    // Statistics Section
    // =======================

    // Function to load all statistics data from the server
    async function loadStats() {
        // Clear any previous hint messages
        dailyViewsHint.textContent = '';
        genrePieHint.textContent = '';

        const userId = encodeURIComponent(loggedInUser);
        try {
            // Fetch both daily views and genre popularity data in parallel
            const [dailyRes, genreRes] = await Promise.all([
                // Get daily views for last 7 days
                fetch(`/api/stats/daily-views?userId=${userId}&days=7`),
                // Get genre popularity data
                fetch(`/api/stats/genre-popularity?userId=${userId}`)
            ]);

            // Check if either request returned 401 (unauthorized)
            if (dailyRes.status === 401 || genreRes.status === 401) {
                window.location.href = '../login.html';
                return;
            }

            // Parse both responses as JSON
            const [dailyData, genreData] = await Promise.all([dailyRes.json(), genreRes.json()]);

            // Render both charts with the fetched data
            renderDailyViewsChart(dailyData);
            renderGenrePieChart(genreData);
        } catch (err) {
            console.error('Failed to load statistics:', err);
            // Show error messages in the hint areas
            dailyViewsHint.textContent = 'Unable to load daily views.';
            genrePieHint.textContent = 'Unable to load genre popularity.';
        }
    }

    // Function to render the daily views bar chart
    function renderDailyViewsChart(raw) {
        const ctx = document.getElementById('dailyViewsChart');
        if (!ctx || typeof Chart === 'undefined') return;

        // Get CSS custom properties for consistent styling
        const styles = getComputedStyle(document.querySelector('.settings-stats'));
        const textColor = styles.getPropertyValue('--chart-text-color').trim();
        const gridColor = styles.getPropertyValue('--chart-grid-color').trim();
        const bgOpacity = parseFloat(styles.getPropertyValue('--chart-bg-opacity')) || 0.65;
        const borderOpacity = parseFloat(styles.getPropertyValue('--chart-border-opacity')) || 1;

        // Prepare arrays for chart labels (days) and datasets (profiles)
        let labels = [];
        let datasets = [];

        // Check if data is in array format (records)
        if (Array.isArray(raw)) {
            // Extract all unique dates from the data
            const daySet = new Set();
            const byProfile = new Map();
            raw.forEach(r => {
                if (!r || !r.date) return;
                const day = (r.date || '').slice(0, 10); // Get YYYY-MM-DD part
                daySet.add(day);
            });
            labels = Array.from(daySet).sort(); // Sort dates chronologically

            // Group views by profile
            raw.forEach(r => {
                if (!r) return;
                const day = (r.date || '').slice(0, 10);
                const key = r.profileId || r.profileName || 'Unknown';
                if (!byProfile.has(key)) {
                    // Create new profile entry with array of zeros for each day
                    byProfile.set(key, { label: r.profileName || findProfileName(r.profileId) || key, values: new Array(labels.length).fill(0) });
                }
                // Add views to the correct day index
                const idx = labels.indexOf(day);
                if (idx >= 0) {
                    byProfile.get(key).values[idx] += Number(r.views || 0);
                }
            });

            // Convert to Chart.js dataset format with colors
            datasets = Array.from(byProfile.values()).map((p, i) => ({
                label: p.label,
                data: p.values,
                backgroundColor: colorForIndex(i, bgOpacity),
                borderColor: colorForIndex(i, borderOpacity),
                borderWidth: 1
            }));
        } else if (raw && Array.isArray(raw.days) && Array.isArray(raw.series)) {
            // Data is already in series format
            labels = raw.days.slice();
            datasets = raw.series.map((s, i) => ({
                label: s.profileName || findProfileName(s.profileId) || `Profile ${i + 1}`,
                data: Array.isArray(s.data) ? s.data : [],
                backgroundColor: colorForIndex(i, bgOpacity),
                borderColor: colorForIndex(i, borderOpacity),
                borderWidth: 1
            }));
        }

        // Calculate total views to check if there's any data
        const total = datasets.reduce((acc, ds) => acc + ds.data.reduce((a, v) => a + v, 0), 0);
        if (total === 0) {
            dailyViewsHint.textContent = 'No views recorded for the selected period.';
        } else {
            dailyViewsHint.textContent = '';
        }

        // Destroy previous chart instance if it exists
        if (dailyViewsChart) {
            dailyViewsChart.destroy();
        }

        // Create new bar chart
        dailyViewsChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: textColor } },
                    tooltip: { mode: 'index', intersect: false } // Show all datasets on hover
                },
                scales: {
                    x: {
                        stacked: true, // Stack bars on top of each other
                        ticks: { color: textColor },
                        grid: { color: gridColor }
                    },
                    y: {
                        stacked: true, // Stack values on Y axis
                        beginAtZero: true,
                        ticks: { color: textColor },
                        grid: { color: gridColor }
                    }
                }
            }
        });
    }

    // Function to render the genre popularity pie chart
    function renderGenrePieChart(raw) {
        const ctx = document.getElementById('genrePieChart');
        if (!ctx || typeof Chart === 'undefined') return;

        // Get styling from CSS variables
        const styles = getComputedStyle(document.querySelector('.settings-stats'));
        const legendColor = styles.getPropertyValue('--chart-legend-color').trim();

        // Prepare data arrays for the chart
        const labels = [];
        const data = [];
        if (Array.isArray(raw)) {
            // Extract genre names and view counts
            raw.forEach(r => {
                if (!r) return;
                labels.push(r.genre || 'Unknown');
                data.push(Number(r.views || r.count || 0));
            });
        }

        // Calculate total to check if there's data
        const total = data.reduce((a, v) => a + v, 0);
        if (total === 0) {
            genrePieHint.textContent = 'No popularity data available.';
        } else {
            genrePieHint.textContent = '';
        }

        // Generate colors for each genre slice
        const colors = labels.map((_, i) => colorForIndex(i, 0.85));

        // Destroy previous chart if it exists
        if (genrePieChart) {
            genrePieChart.destroy();
        }

        // Create new pie chart
        genrePieChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderColor: colors.map(c => c.replace(/, ?0\.\d+\)$/, ', 1)')), // Solid borders
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: legendColor } },
                    tooltip: { 
                        callbacks: {
                            // Custom tooltip showing count and percentage
                            label: (ctx) => {
                                const v = ctx.parsed || 0;
                                const pct = total ? Math.round((v / total) * 100) : 0;
                                return `${ctx.label}: ${v} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // Helper function to find profile name from cached profiles
    function findProfileName(profileId) {
        const p = profilesCache.find(x => x.id === profileId);
        return p?.name || null;
    }

    // Generate consistent colors for charts using HSL color space
    function colorForIndex(i, alpha = 1) {
        const hue = (i * 57) % 360; // Spread hues evenly across color wheel
        return `rgba(${hslToRgb(hue / 360, 0.62, 0.52).join(', ')}, ${alpha})`;
    }
    
    // Convert HSL color to RGB values (0-255)
    function hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) { 
            // Grayscale
            r = g = b = l; 
        } else {
            // Helper function for color conversion
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
        // Return RGB values as integers
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    // Load profiles and statistics when page loads
    loadProfiles();
    loadStats();
});