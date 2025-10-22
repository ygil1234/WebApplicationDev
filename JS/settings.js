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
            displayProfiles(profiles);
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
                const profileId = parseInt(btn.getAttribute('data-id'));
                const profile = profiles.find(p => p.id === profileId);
                if (profile) openEditModal(profile);
            });
        });

        document.querySelectorAll('.profile-btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const profileId = parseInt(btn.getAttribute('data-id'));
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
        const profileId = parseInt(editProfileIdInput.value);
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

            // Reload profiles list
            await loadProfiles();

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

    // Initial load of profiles
    loadProfiles();
});