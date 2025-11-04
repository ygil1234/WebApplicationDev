document.addEventListener("DOMContentLoaded", async () => {
    const profilesGrid = document.getElementById('profilesGrid');
    const errorMessage = document.getElementById('errorMessage');
    const manageProfilesBtn = document.getElementById('manageProfilesBtn');

    // Check if user is logged in
    const loggedInUser = sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser');
    if (!loggedInUser) {
        window.location.href = '/login.html';
        return;
    }

    // Load profiles from server
    async function loadProfiles() {
        try {
            profilesGrid.innerHTML = '<div class="loading">Loading profiles...</div>';
            errorMessage.textContent = '';

            const response = await fetch(`/api/profiles?userId=${encodeURIComponent(loggedInUser)}`);
            
            if (!response.ok) {
                if (response.status === 401) {
                    // Unauthorized - redirect to login
                    window.location.href = '/login.html';
                    return;
                }
                throw new Error('Failed to load profiles');
            }

            const profiles = await response.json();
            displayProfiles(profiles);
            
            if (profiles.length > 0) {
                manageProfilesBtn.style.display = 'inline-block';
            }
        } catch (error) {
            console.error('Error loading profiles:', error);
            errorMessage.textContent = 'Failed to load profiles. Please try again.';
            profilesGrid.innerHTML = '';
        }
    }

    function displayProfiles(profiles) {
        profilesGrid.innerHTML = '';

        // Display existing profiles
        profiles.forEach(profile => {
            const profileItem = document.createElement('div');
            profileItem.className = 'profile-item';
            profileItem.innerHTML = `
                <div class="profile-avatar">
                    <img src="${profile.avatar}" alt="${profile.name}'s Profile">
                </div>
                <div class="profile-name">${profile.name}</div>
            `;
            
            profileItem.addEventListener('click', () => selectProfile(profile));
            profilesGrid.appendChild(profileItem);
        });

        // Add "Add Profile" button if less than 5 profiles
        if (profiles.length < 5) {
            const addProfileItem = document.createElement('div');
            addProfileItem.className = 'profile-item add-profile-item';
            addProfileItem.innerHTML = `
                <div class="add-profile-circle">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
                    </svg>
                </div>
                <div class="add-profile-text">Add Profile</div>
            `;
            
            // Redirect to settings page 
            addProfileItem.addEventListener('click', () => {
                window.location.href = '/settings.html';
            });
            
            profilesGrid.appendChild(addProfileItem);
        }
    }

    function selectProfile(profile) {
        localStorage.setItem('selectedProfileId', String(profile.id));
        localStorage.setItem('selectedProfileName', profile.name);
        localStorage.setItem('selectedProfileAvatar', profile.avatar);
        window.location.href = '/feed.html';
    }

    // Manage Profiles button click handler
    manageProfilesBtn.addEventListener('click', () => {
        window.location.href = '/settings.html';
    });

    // Initial load
    await loadProfiles();
});
