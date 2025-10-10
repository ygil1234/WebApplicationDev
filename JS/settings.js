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

    let selectedAvatar = 'IMG/profile1.jpg'; // Default selection

    // Avatar selection handling
    const avatarOptions = avatarGrid.querySelectorAll('.avatar-option');
    avatarOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Remove selected class from all options
            avatarOptions.forEach(opt => opt.classList.remove('selected'));
            
            // Add selected class to clicked option
            option.classList.add('selected');
            
            // Store selected avatar
            selectedAvatar = option.getAttribute('data-avatar');
        });
    });

    // Select first avatar by default
    avatarOptions[0].classList.add('selected');

    // Form submission handling
    addProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const profileName = profileNameInput.value.trim();

        // Clear previous messages
        clearError(profileNameInput, profileNameError);
        successMessage.textContent = '';
        successMessage.classList.add('d-none');

        // Client-side validation
        if (!profileName||profileName.length < 1) {
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
                throw new Error(data.error || 'Failed to create profile');
            }

            // Success
            showSuccess('Profile created successfully! Redirecting...');
            
            // Clear form
            profileNameInput.value = '';
            avatarOptions.forEach(opt => opt.classList.remove('selected'));
            avatarOptions[0].classList.add('selected');
            selectedAvatar = 'IMG/profile1.jpg';

            // Redirect to profiles page after 2 seconds
            setTimeout(() => {
                window.location.href = 'profiles.html';
            }, 2000);

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
    }
});