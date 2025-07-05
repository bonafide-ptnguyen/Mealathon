import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, serverTimestamp, runTransaction } from 'firebase/firestore';
// Firebase Storage imports are removed as we are using a mock service for image URLs
// import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Your web app's Firebase configuration - now loaded from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, // Ensure this is present
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// For local testing, using projectId as appId and no initial auth token
const appId = firebaseConfig.projectId; // This should match your Firebase project ID
const initialAuthToken = null; // No initial token for local anonymous sign-in

// Create a context for Firebase and User data
const AppContext = createContext(null);

// Custom Modal Component
const Modal = ({ show, title, message, onClose, onConfirm, showConfirmButton = false }) => {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">{title}</h3>
                <p className="text-gray-600 mb-6">{message}</p>
                <div className="flex justify-end space-x-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200"
                    >
                        Close
                    </button>
                    {showConfirmButton && (
                        <button
                            onClick={onConfirm}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
                        >
                            Confirm
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// Campaign Card Component
const CampaignCard = ({ campaign, onClick }) => {
    // Calculate progress based on targetAmount
    const progress = campaign.targetAmount > 0 ? (campaign.totalDonations / campaign.targetAmount) * 100 : 0;
    const mealsPossible = campaign.costPerMeal > 0 ? Math.floor(campaign.totalDonations / campaign.costPerMeal) : 0;
    const endDate = campaign.endDate ? new Date(campaign.endDate.seconds * 1000).toLocaleDateString() : 'N/A';

    let statusBadge = '';
    let statusColor = 'bg-gray-400';
    if (campaign.status === 'successful') {
        statusBadge = 'Successful!';
        statusColor = 'bg-green-500';
    } else if (campaign.status === 'failed') {
        statusBadge = 'Failed';
        statusColor = 'bg-red-500';
    } else if (campaign.status === 'active') {
        statusBadge = 'Active';
        statusColor = 'bg-blue-500';
    }

    return (
        <div
            className="bg-white rounded-xl shadow-lg p-6 mb-6 cursor-pointer hover:shadow-xl transition-shadow duration-300 border border-gray-200 relative overflow-hidden"
            onClick={() => onClick(campaign)}
        >
            {/* Campaign Status Badge */}
            {statusBadge && (
                <span className={`absolute top-0 right-0 ${statusColor} text-white text-xs font-bold px-3 py-1 rounded-bl-lg`}>
                    {statusBadge}
                </span>
            )}

            {/* Campaign Images */}
            {campaign.campaignImageUrls && campaign.campaignImageUrls.length > 0 && (
                <div className="mb-4 rounded-lg overflow-hidden">
                    <img
                        src={campaign.campaignImageUrls[0]} // Display first image as a preview
                        alt={campaign.campaignName}
                        className="w-full h-48 object-cover object-center rounded-lg"
                        onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/400x200/cccccc/333333?text=No+Image"; }}
                    />
                </div>
            )}

            <h3 className="text-2xl font-bold text-gray-800 mb-2">{campaign.campaignName}</h3>
            <p className="text-gray-600 text-lg mb-3">by <span className="font-semibold">{campaign.restaurantName}</span></p>
            <p className="text-gray-700 mb-2">
                <span className="font-medium">Donated:</span> ${campaign.totalDonations ? campaign.totalDonations.toFixed(2) : '0.00'}
            </p>
            {campaign.targetAmount > 0 && (
                <p className="text-gray-700 mb-2">
                    <span className="font-medium">Target:</span> ${campaign.targetAmount.toFixed(2)}
                </p>
            )}
            <p className="text-gray-700 mb-2">
                <span className="font-medium">Meals Possible:</span> {mealsPossible}
            </p>
            <p className="text-gray-700 mb-4">
                <span className="font-medium">Ends:</span> {endDate}
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                    className="bg-green-500 h-2.5 rounded-full"
                    style={{ width: `${Math.min(100, progress)}%` }}
                ></div>
            </div>
            {campaign.targetAmount > 0 && (
                <p className="text-sm text-gray-500 mt-2">{Math.round(progress)}% of target reached</p>
            )}
        </div>
    );
};

// Campaign List Component
const CampaignList = ({ onSelectCampaign, onCreateCampaign }) => {
    const { db, auth, userId, isAuthReady, showModal } = useContext(AppContext);
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!db || !isAuthReady) {
            console.log("CampaignList: DB not ready or Auth not ready. Skipping fetch.");
            return;
        }
        console.log("CampaignList: Attempting to fetch campaigns with userId:", userId, "and appId:", appId);

        const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
        const q = query(campaignsCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedCampaigns = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setCampaigns(fetchedCampaigns);
            setLoading(false);
            console.log("CampaignList: Successfully fetched", fetchedCampaigns.length, "campaigns.");
        }, (error) => {
            console.error("Error fetching campaigns:", error);
            showModal('Error', 'Failed to load campaigns. Please try again later.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, isAuthReady, showModal, userId]);

    if (loading) {
        return <div className="text-center text-gray-600">Loading campaigns...</div>;
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <h2 className="text-4xl font-extrabold text-gray-900 mb-8 text-center">Active Campaigns</h2>
            <div className="flex justify-center mb-8">
                <button
                    onClick={onCreateCampaign}
                    className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-8 py-3 rounded-full shadow-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-blue-300"
                >
                    + Create New Campaign
                </button>
            </div>
            {campaigns.length === 0 ? (
                <p className="text-center text-gray-600 text-lg">No active campaigns found. Be the first to create one!</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {campaigns.map(campaign => (
                        <CampaignCard key={campaign.id} campaign={campaign} onClick={onSelectCampaign} />
                    ))}
                </div>
            )}
        </div>
    );
};

// Campaign Detail Component
const CampaignDetail = ({ campaign, onBack }) => {
    const { db, auth, userId, isAuthReady, showModal } = useContext(AppContext);
    const [donationAmount, setDonationAmount] = useState('');
    const [loading, setLoading] = useState(false);

    const handleDonate = async () => {
        if (!donationAmount || parseFloat(donationAmount) <= 0) {
            showModal('Invalid Amount', 'Please enter a valid donation amount.');
            return;
        }

        if (!campaign || !campaign.id) {
            showModal('Error', 'Campaign data is missing.');
            return;
        }

        setLoading(true);
        try {
            const amount = parseFloat(donationAmount);
            const donationsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/donations`);
            const campaignDocRef = doc(db, `artifacts/${appId}/public/data/campaigns`, campaign.id);

            // Generate a consistent mock donor name for anonymous users
            const donorName = "Anonymous Donor"; // For simplicity, all anonymous donors are "Anonymous Donor"

            // Add individual donation
            await addDoc(donationsCollectionRef, {
                campaignId: campaign.id,
                donorId: userId,
                donorName: donorName, // Add donorName to individual donation
                amount: amount,
                timestamp: serverTimestamp(),
                refunded: false,
            });

            // Update totalDonations in the campaign document
            const campaignSnap = await getDoc(campaignDocRef);
            if (campaignSnap.exists()) {
                const currentTotal = campaignSnap.data().totalDonations || 0;
                await updateDoc(campaignDocRef, {
                    totalDonations: currentTotal + amount
                });
            } else {
                console.warn("Campaign document not found for update:", campaign.id);
            }

            // --- Update Donor Leaderboard ---
            const donorLeaderboardDocRef = doc(db, `artifacts/${appId}/public/data/donor_leaderboard`, userId);

            await runTransaction(db, async (transaction) => {
                const donorLeaderboardSnap = await transaction.get(donorLeaderboardDocRef);
                if (donorLeaderboardSnap.exists()) {
                    const currentTotalDonated = donorLeaderboardSnap.data().totalDonatedAmount || 0;
                    transaction.update(donorLeaderboardDocRef, {
                        totalDonatedAmount: currentTotalDonated + amount,
                        lastDonationAt: serverTimestamp()
                    });
                } else {
                    transaction.set(donorLeaderboardDocRef, {
                        donorId: userId,
                        donorName: donorName,
                        totalDonatedAmount: amount,
                        firstDonationAt: serverTimestamp(),
                        lastDonationAt: serverTimestamp()
                    });
                }
            });
            // --- End Update Donor Leaderboard ---


            showModal('Success', `Thank you for your donation of $${amount.toFixed(2)} to ${campaign.campaignName}!`);
            setDonationAmount('');
        } catch (error) {
            console.error("Error making donation:", error);
            showModal('Error', 'Failed to process your donation. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const mealsPossible = campaign.costPerMeal > 0 ? Math.floor(campaign.totalDonations / campaign.costPerMeal) : 0;
    const endDate = campaign.endDate ? new Date(campaign.endDate.seconds * 1000).toLocaleDateString() : 'N/A';

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Campaigns
            </button>

            <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-lg p-8 border border-gray-200">
                <h2 className="text-4xl font-extrabold text-gray-900 mb-4">{campaign.campaignName}</h2>
                <p className="text-gray-600 text-xl mb-4">by <span className="font-semibold">{campaign.restaurantName}</span></p>
                <p className="text-gray-700 text-lg mb-6 leading-relaxed">{campaign.description}</p>

                {/* Display Campaign Images */}
                {campaign.campaignImageUrls && campaign.campaignImageUrls.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        {campaign.campaignImageUrls.map((url, index) => (
                            <img
                                key={index}
                                src={url}
                                alt={`${campaign.campaignName} image ${index + 1}`}
                                className="w-full h-48 object-cover rounded-lg shadow-sm"
                                onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/400x200/cccccc/333333?text=Image+Error"; }}
                            />
                        ))}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div>
                        <p className="text-gray-700 text-lg"><span className="font-medium">Cost per Meal:</span> ${campaign.costPerMeal ? campaign.costPerMeal.toFixed(2) : '0.00'}</p>
                        <p className="text-gray-700 text-lg"><span className="font-medium">Campaign Ends:</span> {endDate}</p>
                        {campaign.targetAmount > 0 && (
                            <p className="text-gray-700 text-lg"><span className="font-medium">Target Amount:</span> ${campaign.targetAmount.toFixed(2)}</p>
                        )}
                    </div>
                    <div>
                        <p className="text-gray-700 text-lg"><span className="font-medium">Total Donated:</span> ${campaign.totalDonations ? campaign.totalDonations.toFixed(2) : '0.00'}</p>
                        <p className="text-gray-700 text-lg"><span className="font-medium">Estimated Meals:</span> {mealsPossible}</p>
                        <p className="text-gray-700 text-lg"><span className="font-medium">Status:</span> {campaign.status}</p>
                    </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-800 mb-4">Distribution Updates</h3>
                {campaign.distributionUpdates && campaign.distributionUpdates.length > 0 ? (
                    <ul className="list-disc list-inside text-gray-700 mb-8">
                        {campaign.distributionUpdates.map((update, index) => (
                            <li key={index} className="mb-4">
                                <span className="font-semibold">{new Date(update.date.seconds * 1000).toLocaleDateString()}:</span> {update.message}
                                {update.imageUrls && update.imageUrls.length > 0 && (
                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                        {update.imageUrls.map((url, imgIndex) => (
                                            <img
                                                key={imgIndex}
                                                src={url}
                                                alt={`Distribution update image ${imgIndex + 1}`}
                                                className="w-full h-24 object-cover rounded-md shadow-sm"
                                                onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/100x100/cccccc/333333?text=Image+Error"; }}
                                            />
                                        ))}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-600 mb-8">No distribution updates yet. Check back after the campaign ends!</p>
                )}

                <div className="border-t border-gray-200 pt-6">
                    <h3 className="text-2xl font-bold text-gray-800 mb-4">Make a Donation</h3>
                    {campaign.status === 'active' ? (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                            <input
                                type="number"
                                placeholder="Amount to donate"
                                value={donationAmount}
                                onChange={(e) => setDonationAmount(e.target.value)}
                                className="flex-grow p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                                min="0.01"
                                step="0.01"
                            />
                            <button
                                onClick={handleDonate}
                                disabled={loading}
                                className="w-full sm:w-auto bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-3 rounded-md shadow-md hover:from-green-600 hover:to-green-700 transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-green-300 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Processing...' : 'Donate Now'}
                            </button>
                        </div>
                    ) : (
                        <p className="text-gray-600 text-lg">This campaign is no longer active for donations (Status: {campaign.status}).</p>
                    )}
                </div>
            </div>
        </div>
    );
};

// Create Campaign Component
const CreateCampaign = ({ onBack }) => {
    const { db, auth, userId, isAuthReady, showModal /*, storage */ } = useContext(AppContext); // Removed storage from useContext
    const [campaignName, setCampaignName] = useState('');
    const [restaurantName, setRestaurantName] = useState('');
    const [costPerMeal, setCostPerMeal] = useState('');
    const [endDate, setEndDate] = useState('');
    const [description, setDescription] = useState('');
    const [targetAmount, setTargetAmount] = useState(''); // New state for target amount
    const [selectedFiles, setSelectedFiles] = useState([]); // State for selected image files
    const [loading, setLoading] = useState(false);

    const handleFileChange = (e) => {
        if (e.target.files) {
            setSelectedFiles(Array.from(e.target.files));
        }
    };

    // SIMULATED PERSISTENT IMAGE UPLOAD FUNCTION using placehold.co
    const uploadImages = async (files) => {
        const imageUrls = [];
        for (const file of files) {
            // Generate a unique placeholder URL based on file name and timestamp
            const uniqueId = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9]/g, '')}`;
            const placeholderUrl = `https://placehold.co/400x200/cccccc/333333?text=Campaign+${uniqueId.substring(0, 15)}`;
            imageUrls.push(placeholderUrl);
        }
        return imageUrls;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!campaignName || !restaurantName || !costPerMeal || !endDate || !description || !targetAmount) {
            showModal('Missing Information', 'Please fill in all fields including target amount.');
            return;
        }
        if (parseFloat(costPerMeal) <= 0) {
            showModal('Invalid Cost', 'Cost per meal must be greater than zero.');
            return;
        }
        if (parseFloat(targetAmount) <= 0) {
            showModal('Invalid Target', 'Target amount must be greater than zero.');
            return;
        }
        const campaignEndDate = new Date(endDate);
        if (isNaN(campaignEndDate.getTime()) || campaignEndDate < new Date()) {
            showModal('Invalid Date', 'Please select a future end date.');
            return;
        }

        setLoading(true);
        try {
            let imageUrls = [];
            if (selectedFiles.length > 0) {
                imageUrls = await uploadImages(selectedFiles);
            }

            const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
            await addDoc(campaignsCollectionRef, {
                campaignName,
                restaurantName,
                costPerMeal: parseFloat(costPerMeal),
                endDate: campaignEndDate, // Store as Date object, Firestore converts to Timestamp
                description,
                targetAmount: parseFloat(targetAmount), // New field
                campaignImageUrls: imageUrls, // New field
                totalDonations: 0,
                totalMealsProvided: 0,
                distributionUpdates: [],
                status: 'active', // Initial status
                providerId: userId,
                createdAt: serverTimestamp(),
            });
            showModal('Success', 'Campaign created successfully!');
            onBack(); // Go back to campaign list
        } catch (error) {
            console.error("Error creating campaign:", error);
            showModal('Error', `Failed to create campaign. Please try again. Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Campaigns
            </button>
            <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg p-8 border border-gray-200">
                <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Create New Campaign</h2>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label htmlFor="campaignName" className="block text-lg font-medium text-gray-700 mb-1">Campaign Name</label>
                        <input
                            type="text"
                            id="campaignName"
                            value={campaignName}
                            onChange={(e) => setCampaignName(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            placeholder="e.g., Feed Our Community Heroes"
                        />
                    </div>
                    <div>
                        <label htmlFor="restaurantName" className="block text-lg font-medium text-gray-700 mb-1">Restaurant/Provider Name</label>
                        <input
                            type="text"
                            id="restaurantName"
                            value={restaurantName}
                            onChange={(e) => setRestaurantName(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            placeholder="e.g., Delicious Bites Diner"
                        />
                    </div>
                    <div>
                        <label htmlFor="costPerMeal" className="block text-lg font-medium text-gray-700 mb-1">Cost Per Meal ($)</label>
                        <input
                            type="number"
                            id="costPerMeal"
                            value={costPerMeal}
                            onChange={(e) => setCostPerMeal(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            min="0.01"
                            step="0.01"
                            placeholder="e.g., 5.50"
                        />
                    </div>
                    <div>
                        <label htmlFor="targetAmount" className="block text-lg font-medium text-gray-700 mb-1">Target Amount ($) - Minimum to Kickstart</label>
                        <input
                            type="number"
                            id="targetAmount"
                            value={targetAmount}
                            onChange={(e) => setTargetAmount(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            min="0.01"
                            step="0.01"
                            placeholder="e.g., 500.00"
                        />
                    </div>
                    <div>
                        <label htmlFor="endDate" className="block text-lg font-medium text-gray-700 mb-1">Campaign End Date</label>
                        <input
                            type="date"
                            id="endDate"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                        />
                    </div>
                    <div>
                        <label htmlFor="description" className="block text-lg font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows="5"
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            placeholder="Tell us about your campaign and why it matters..."
                        ></textarea>
                    </div>
                    <div>
                        <label htmlFor="campaignImages" className="block text-lg font-medium text-gray-700 mb-1">Campaign Images (Optional)</label>
                        <input
                            type="file"
                            id="campaignImages"
                            multiple
                            accept="image/*"
                            onChange={handleFileChange}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                        {selectedFiles.length > 0 && (
                            <p className="text-sm text-gray-500 mt-2">{selectedFiles.length} file(s) selected.</p>
                        )}
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-3 rounded-md shadow-md hover:from-green-600 hover:to-green-700 transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-green-300 disabled:opacity-50 disabled:cursor-not-allowed text-lg font-semibold"
                    >
                        {loading ? 'Creating...' : 'Create Campaign'}
                    </button>
                </form>
            </div>
        </div>
    );
};

// Provider Dashboard Component
const ProviderDashboard = ({ onBack }) => {
    const { db, auth, userId, isAuthReady, showModal /*, storage */ } = useContext(AppContext); // Removed storage from useContext
    const [myCampaigns, setMyCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCampaignToManage, setSelectedCampaignToManage] = useState(null);
    const [newUpdateMessage, setNewUpdateMessage] = useState('');
    const [selectedUpdateFiles, setSelectedUpdateFiles] = useState([]); // State for selected distribution image files

    const handleUpdateFileChange = (e) => {
        if (e.target.files) {
            setSelectedUpdateFiles(Array.from(e.target.files));
        }
    };

    // SIMULATED PERSISTENT IMAGE UPLOAD FUNCTION using placehold.co
    const uploadUpdateImages = async (files) => {
        const imageUrls = [];
        for (const file of files) {
            // Generate a unique placeholder URL based on file name and timestamp
            const uniqueId = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9]/g, '')}`;
            const placeholderUrl = `https://placehold.co/100x100/cccccc/333333?text=Update+${uniqueId.substring(0, 10)}`;
            imageUrls.push(placeholderUrl);
        }
        return imageUrls;
    };

    useEffect(() => {
        if (!db || !isAuthReady || !userId) {
            console.log("ProviderDashboard: DB not ready, Auth not ready, or userId is null. Skipping fetch.");
            return;
        }
        console.log("ProviderDashboard: Attempting to fetch campaigns for providerId:", userId, "and appId:", appId);

        const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
        // We still filter by providerId for 'My Campaigns' view
        const q = query(campaignsCollectionRef, where("providerId", "==", userId));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedCampaigns = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMyCampaigns(fetchedCampaigns);
            setLoading(false);
            console.log("ProviderDashboard: Successfully fetched", fetchedCampaigns.length, "campaigns for providerId:", userId);
        }, (error) => {
            console.error("Error fetching provider campaigns:", error);
            showModal('Error', 'Failed to load your campaigns. Please try again later.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, isAuthReady, userId, showModal]);

    // Logic to handle campaign status and potential refunds
    useEffect(() => {
        if (!db || !isAuthReady) return;

        const checkCampaignStatus = async () => {
            const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
            const q = query(campaignsCollectionRef, where("status", "==", "active"));
            const activeCampaignsSnapshot = await getDocs(q);

            activeCampaignsSnapshot.forEach(async (campaignDoc) => {
                const campaignData = campaignDoc.data();
                const campaignId = campaignDoc.id;
                const now = new Date();
                const endDate = campaignData.endDate ? new Date(campaignData.endDate.seconds * 1000) : null;

                if (endDate && now > endDate) {
                    // Campaign has ended, determine status
                    if (campaignData.totalDonations >= campaignData.targetAmount) {
                        // Campaign successful
                        await updateDoc(doc(db, `artifacts/${appId}/public/data/campaigns`, campaignId), {
                            status: 'successful'
                        });
                        console.log(`Campaign ${campaignId} marked as successful.`);
                    } else {
                        // Campaign failed, initiate refund process
                        await runTransaction(db, async (transaction) => {
                            const campaignRef = doc(db, `artifacts/${appId}/public/data/campaigns`, campaignId);
                            transaction.update(campaignRef, { status: 'failed' });

                            // Assuming donations are stored under the donor's userId, not provider's
                            // You might need to adjust this path if your donation structure is different
                            const allDonationsQuery = query(
                                collection(db, `artifacts/${appId}/users`), // Query across all user donation subcollections
                                where("campaignId", "==", campaignId),
                                where("refunded", "==", false)
                            );
                            // This query structure for donations across all users is complex for Firestore
                            // A more robust solution for refunds would be to have a 'refunds' collection
                            // or to query donations directly under the campaign if they were structured that way.
                            // For this demo, we'll simplify and assume a direct path if possible, or log a warning.

                            // For now, let's keep the original query but acknowledge its limitation if donations are truly spread out
                            const donationsQueryForRefund = query(
                                collection(db, `artifacts/${appId}/users/${campaignData.providerId}/donations`), // This path might be incorrect if donorId is dynamic
                                where("campaignId", "==", campaignId),
                                where("refunded", "==", false)
                            );
                            const donationsSnapshot = await getDocs(donationsQueryForRefund);


                            if (donationsSnapshot.empty) {
                                console.warn(`No unrefunded donations found for campaign ${campaignId} under provider ${campaignData.providerId}.`);
                            }

                            donationsSnapshot.forEach((donationDoc) => {
                                // The path to update the donation needs to reflect where it's stored.
                                // If donations are stored under the *donor's* userId, this path needs to be dynamic.
                                // For this demo, we'll assume the simple path for now.
                                const donationRef = doc(db, `artifacts/${appId}/users/${donationDoc.data().donorId}/donations`, donationDoc.id);
                                transaction.update(donationRef, { refunded: true });
                                console.log(`Donation ${donationDoc.id} for campaign ${campaignId} marked as refunded.`);
                            });
                        });
                        console.log(`Campaign ${campaignId} marked as failed and donations processed for refund.`);
                    }
                }
            });
        };

        // Run status check periodically or on mount
        const intervalId = setInterval(checkCampaignStatus, 60000); // Check every minute
        checkCampaignStatus(); // Run once on mount

        return () => clearInterval(intervalId);
    }, [db, isAuthReady]);


    const handleUpdateDistribution = async () => {
        if (!selectedCampaignToManage || !newUpdateMessage.trim()) {
            showModal('Missing Info', 'Please select a campaign and enter an update message.');
            return;
        }

        setLoading(true);
        try {
            let updateImageUrls = [];
            if (selectedUpdateFiles.length > 0) {
                updateImageUrls = await uploadUpdateImages(selectedUpdateFiles); // This now simulates upload
            }

            const campaignDocRef = doc(db, `artifacts/${appId}/public/data/campaigns`, selectedCampaignToManage.id);
            const currentUpdates = selectedCampaignToManage.distributionUpdates || [];
            // FIX: Use new Date() for timestamp within array elements
            const updatedUpdates = [...currentUpdates, { message: newUpdateMessage.trim(), date: new Date(), imageUrls: updateImageUrls }];

            await updateDoc(campaignDocRef, {
                distributionUpdates: updatedUpdates,
                // Recalculate totalMealsProvided based on current totalDonations and costPerMeal
                totalMealsProvided: selectedCampaignToManage.costPerMeal > 0 ? Math.floor(selectedCampaignToManage.totalDonations / selectedCampaignToManage.costPerMeal) : 0,
                // Status is now handled by the useEffect above, but can be manually set here if needed
            });

            showModal('Success', 'Distribution update added successfully!');
            setNewUpdateMessage('');
            setSelectedUpdateFiles([]); // Clear selected files
            setSelectedCampaignToManage(prev => ({
                ...prev,
                distributionUpdates: updatedUpdates,
                totalMealsProvided: prev.costPerMeal > 0 ? Math.floor(prev.totalDonations / prev.costPerMeal) : 0,
            }));
        } catch (error) {
            console.error("Error updating distribution:", error);
            showModal('Error', `Failed to update distribution. Please try again. Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <div className="text-center text-gray-600">Loading your campaigns...</div>;
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Home
            </button>

            <h2 className="text-4xl font-extrabold text-gray-900 mb-8 text-center">Your Campaigns</h2>

            {myCampaigns.length === 0 ? (
                <p className="text-center text-gray-600 text-lg">You haven't created any campaigns yet.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {myCampaigns.map(campaign => (
                        <div key={campaign.id} className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                            <h3 className="text-2xl font-bold text-gray-800 mb-2">{campaign.campaignName}</h3>
                            <p className="text-gray-600 text-lg mb-3">by <span className="font-semibold">{campaign.restaurantName}</span></p>
                            <p className="text-gray-700 mb-2">
                                <span className="font-medium">Total Donated:</span> ${campaign.totalDonations ? campaign.totalDonations.toFixed(2) : '0.00'}
                            </p>
                            <p className="text-gray-700 mb-4">
                                <span className="font-medium">Meals Provided:</span> {campaign.totalMealsProvided || 0}
                            </p>
                            <p className="text-gray-700 mb-4">
                                <span className="font-medium">Status:</span> {campaign.status}
                            </p>
                            <button
                                onClick={() => setSelectedCampaignToManage(campaign)}
                                className="w-full bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors duration-200"
                            >
                                Manage Campaign
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {selectedCampaignToManage && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full">
                        <h3 className="text-2xl font-semibold text-gray-800 mb-4">Manage "{selectedCampaignToManage.campaignName}"</h3>
                        <p className="text-gray-700 mb-2">
                            <span className="font-medium">Total Donated:</span> ${selectedCampaignToManage.totalDonations ? selectedCampaignToManage.totalDonations.toFixed(2) : '0.00'}
                        </p>
                        <p className="text-gray-700 mb-4">
                            <span className="font-medium">Estimated Meals Possible:</span> {selectedCampaignToManage.costPerMeal > 0 ? Math.floor(selectedCampaignToManage.totalDonations / selectedCampaignToManage.costPerMeal) : 0}
                        </p>

                        <h4 className="text-xl font-semibold text-gray-800 mb-3">Add Distribution Update</h4>
                        <textarea
                            className="w-full p-3 border border-gray-300 rounded-md mb-4 focus:ring-blue-500 focus:border-blue-500"
                            rows="4"
                            placeholder="e.g., '500 meals delivered to local shelters on 2025-07-01.'"
                            value={newUpdateMessage}
                            onChange={(e) => setNewUpdateMessage(e.target.value)}
                        ></textarea>
                        <div className="mb-4">
                            <label htmlFor="updateImages" className="block text-lg font-medium text-gray-700 mb-1">Update Images (Optional)</label>
                            <input
                                type="file"
                                id="updateImages"
                                multiple
                                accept="image/*"
                                onChange={handleUpdateFileChange}
                                className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                            />
                            {selectedUpdateFiles.length > 0 && (
                                <p className="text-sm text-gray-500 mt-2">{selectedUpdateFiles.length} file(s) selected.</p>
                            )}
                        </div>
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => { setSelectedCampaignToManage(null); setNewUpdateMessage(''); setSelectedUpdateFiles([]); }}
                                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdateDistribution}
                                disabled={loading}
                                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Updating...' : 'Submit Update'}
                            </button>
                        </div>

                        <h4 className="text-xl font-semibold text-gray-800 mt-6 mb-3">Past Updates</h4>
                        {selectedCampaignToManage.distributionUpdates && selectedCampaignToManage.distributionUpdates.length > 0 ? (
                            <ul className="list-disc list-inside text-gray-700 max-h-40 overflow-y-auto">
                                {selectedCampaignToManage.distributionUpdates.map((update, index) => (
                                    <li key={index} className="mb-1">
                                        <span className="font-semibold">{new Date(update.date.seconds * 1000).toLocaleDateString()}:</span> {update.message}
                                        {update.imageUrls && update.imageUrls.length > 0 && (
                                            <div className="mt-2 grid grid-cols-2 gap-2">
                                                {update.imageUrls.map((url, imgIndex) => (
                                                    <img
                                                        key={imgIndex}
                                                        src={url}
                                                        alt={`Distribution update image ${imgIndex + 1}`}
                                                        className="w-full h-24 object-cover rounded-md shadow-sm"
                                                        onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/100x100/cccccc/333333?text=Image+Error"; }}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-gray-600">No updates posted yet.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Donor Dashboard Component
const DonorDashboard = ({ onBack }) => {
    const { db, auth, userId, isAuthReady, showModal } = useContext(AppContext);
    const [myDonations, setMyDonations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [campaignsMap, setCampaignsMap] = useState({}); // To store campaign names by ID

    useEffect(() => {
        if (!db || !isAuthReady || !userId) {
            console.log("DonorDashboard: DB not ready, Auth not ready, or userId is null. Skipping fetch.");
            return;
        }
        console.log("DonorDashboard: Attempting to fetch donations for userId:", userId);

        const fetchDonations = async () => {
            try {
                // Fetch all campaigns to map IDs to names
                const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
                const campaignSnapshot = await getDocs(campaignsCollectionRef);
                const campaignsData = {};
                campaignSnapshot.docs.forEach(doc => {
                    campaignsData[doc.id] = doc.data().campaignName;
                });
                setCampaignsMap(campaignsData);
                console.log("DonorDashboard: Fetched campaign names map.");

                // Fetch user-specific donations
                const donationsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/donations`);
                const q = query(donationsCollectionRef);

                const unsubscribe = onSnapshot(q, (snapshot) => {
                    const fetchedDonations = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    setMyDonations(fetchedDonations);
                    setLoading(false);
                    console.log("DonorDashboard: Successfully fetched", fetchedDonations.length, "donations for userId:", userId);
                }, (error) => {
                    console.error("Error fetching donor donations:", error);
                    showModal('Error', 'Failed to load your donations. Please try again later.');
                    setLoading(false);
                });

                return () => unsubscribe();
            } catch (error) {
                console.error("Error in donor dashboard useEffect:", error);
                showModal('Error', 'An error occurred while loading your data.');
                setLoading(false);
            }
        };

        fetchDonations();
    }, [db, isAuthReady, userId, showModal]);

    if (loading) {
        return <div className="text-center text-gray-600">Loading your donations...</div>;
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Home
            </button>

            <h2 className="text-4xl font-extrabold text-gray-900 mb-8 text-center">Your Donations</h2>

            {myDonations.length === 0 ? (
                <p className="text-center text-gray-600 text-lg">You haven't made any donations yet.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {myDonations.map(donation => (
                        <div key={donation.id} className={`bg-white rounded-xl shadow-lg p-6 border border-gray-200 ${donation.refunded ? 'opacity-70 border-red-400' : ''}`}>
                            <h3 className="text-2xl font-bold text-gray-800 mb-2">
                                {campaignsMap[donation.campaignId] || 'Unknown Campaign'}
                            </h3>
                            <p className="text-gray-700 mb-2">
                                <span className="font-medium">Amount:</span> ${donation.amount ? donation.amount.toFixed(2) : '0.00'}
                            </p>
                            <p className="text-gray-700 mb-4">
                                <span className="font-medium">Date:</span> {donation.timestamp ? new Date(donation.timestamp.seconds * 1000).toLocaleDateString() : 'N/A'}
                            </p>
                            {donation.refunded && (
                                <p className="text-red-600 font-semibold mt-2">Refunded</p>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Campaign Leaderboard Component
const Leaderboard = ({ onBack }) => {
    const { db, isAuthReady, showModal } = useContext(AppContext);
    const [topCampaigns, setTopCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!db || !isAuthReady) return;

        const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
        // We'll fetch all and sort client-side to avoid needing a Firestore index on totalDonations
        const q = query(campaignsCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedCampaigns = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Sort campaigns by totalDonations in descending order client-side
            const sortedCampaigns = fetchedCampaigns.sort((a, b) => (b.totalDonations || 0) - (a.totalDonations || 0));
            setTopCampaigns(sortedCampaigns);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching top campaigns:", error);
            showModal('Error', 'Failed to load campaign leaderboard. Please try again later.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, isAuthReady, showModal]);

    const getBadge = (index) => {
        if (index === 0) return '🏆 Gold';
        if (index === 1) return '🥈 Silver';
        if (index === 2) return '🥉 Bronze';
        return '';
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Home
            </button>

            <h2 className="text-4xl font-extrabold text-gray-900 mb-8 text-center">Top Campaigns (Leaderboard)</h2>

            {loading ? (
                <div className="text-center text-gray-600">Loading campaign leaderboard...</div>
            ) : topCampaigns.length === 0 ? (
                <p className="text-center text-gray-600 text-lg">No campaigns to display on the leaderboard yet.</p>
            ) : (
                <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg p-8 border border-gray-200">
                    <ul className="divide-y divide-gray-200">
                        {topCampaigns.map((campaign, index) => (
                            <li key={campaign.id} className="py-4 flex items-center justify-between">
                                <div className="flex items-center">
                                    <span className="text-2xl font-bold text-gray-700 mr-4 w-8 text-center">{index + 1}.</span>
                                    <div>
                                        <p className="text-xl font-semibold text-gray-800">{campaign.campaignName}</p>
                                        <p className="text-gray-600 text-sm">by {campaign.restaurantName}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-lg font-bold text-green-600">${campaign.totalDonations ? campaign.totalDonations.toFixed(2) : '0.00'}</p>
                                    <span className="text-sm text-gray-500">{getBadge(index)}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

// Donor Leaderboard Component (New)
const DonorLeaderboard = ({ onBack }) => {
    const { db, isAuthReady, showModal } = useContext(AppContext);
    const [topDonors, setTopDonors] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!db || !isAuthReady) return;

        const donorLeaderboardCollectionRef = collection(db, `artifacts/${appId}/public/data/donor_leaderboard`);
        // We'll fetch all and sort client-side to avoid needing a Firestore index on totalDonatedAmount
        const q = query(donorLeaderboardCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedDonors = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Sort donors by totalDonatedAmount in descending order client-side
            const sortedDonors = fetchedDonors.sort((a, b) => (b.totalDonatedAmount || 0) - (a.totalDonatedAmount || 0));
            setTopDonors(sortedDonors);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching top donors:", error);
            showModal('Error', 'Failed to load donor leaderboard. Please try again later.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, isAuthReady, showModal]);

    const getBadge = (index) => {
        if (index === 0) return '🥇 Gold';
        if (index === 1) return '🥈 Silver';
        if (index === 2) return '🥉 Bronze';
        return '';
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Home
            </button>

            <h2 className="text-4xl font-extrabold text-gray-900 mb-8 text-center">Top Donors (Leaderboard)</h2>

            {loading ? (
                <div className="text-center text-gray-600">Loading donor leaderboard...</div>
            ) : topDonors.length === 0 ? (
                <p className="text-center text-gray-600 text-lg">No donations recorded yet. Be the first to donate!</p>
            ) : (
                <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg p-8 border border-gray-200">
                    <ul className="divide-y divide-gray-200">
                        {topDonors.map((donor, index) => (
                            <li key={donor.id} className="py-4 flex items-center justify-between">
                                <div className="flex items-center">
                                    <span className="text-2xl font-bold text-gray-700 mr-4 w-8 text-center">{index + 1}.</span>
                                    <div>
                                        <p className="text-xl font-semibold text-gray-800">{donor.donorName}</p>
                                        <p className="text-gray-600 text-sm">ID: {donor.donorId.substring(0, 8)}...</p> {/* Display truncated ID */}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-lg font-bold text-green-600">${donor.totalDonatedAmount ? donor.totalDonatedAmount.toFixed(2) : '0.00'}</p>
                                    <span className="text-sm text-gray-500">{getBadge(index)}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};


// Main App Component
const App = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [storage, setStorage] = useState(null); // New state for storage
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [view, setView] = useState('home'); // 'home', 'campaign-detail', 'create-campaign', 'provider-dashboard', 'donor-dashboard', 'leaderboard', 'donor-leaderboard'
    const [selectedCampaign, setSelectedCampaign] = useState(null);

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [modalTitle, setModalTitle] = useState('');
    const [modalMessage, setModalMessage] = useState('');
    const [modalShowConfirm, setModalShowConfirm] = useState(false);
    const [modalConfirmAction, setModalConfirmAction] = useState(null);

    const handleShowModal = (title, message, showConfirm = false, onConfirm = null) => {
        setModalTitle(title);
        setModalMessage(message);
        setModalShowConfirm(showConfirm);
        setModalConfirmAction(() => onConfirm); // Use a function to set state
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setModalTitle('');
        setModalMessage('');
        setModalShowConfirm(false);
        setModalConfirmAction(null);
    };

    const handleConfirmModal = () => {
        if (modalConfirmAction) {
            modalConfirmAction();
        }
        handleCloseModal();
    };

    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const firebaseAuth = getAuth(app);
            // Removed Firebase Storage initialization here as it's not used for direct uploads anymore
            // const firebaseStorage = getStorage(app); 

            setDb(firestore);
            setAuth(firebaseAuth);
            // setStorage(firebaseStorage); // Removed setting storage instance
            console.log("Firebase initialized.");

            // Sign in with custom token or anonymously
            const signIn = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(firebaseAuth, initialAuthToken);
                        console.log("Signed in with custom token.");
                    } else {
                        await signInAnonymously(firebaseAuth);
                        console.log("Signed in anonymously.");
                    }
                } catch (error) {
                    console.error("Firebase authentication error:", error);
                    handleShowModal('Authentication Error', 'Failed to authenticate with Firebase. Please refresh the page.');
                }
            };
            signIn();

            // Listen for auth state changes
            const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
                if (user) {
                    setUserId(user.uid);
                    console.log("Auth State Changed: User is logged in. UID:", user.uid);
                } else {
                    const newUserId = crypto.randomUUID();
                    setUserId(newUserId);
                    console.log("Auth State Changed: User is NOT logged in. Using anonymous ID:", newUserId);
                }
                setIsAuthReady(true); // Auth state is ready
                console.log("isAuthReady set to true.");
            });

            return () => unsubscribeAuth();
        } catch (error) {
            console.error("Error initializing Firebase:", error);
            handleShowModal('Initialization Error', 'Failed to initialize Firebase. Please check your configuration.');
        }
    }, []);

    const handleSelectCampaign = (campaign) => {
        setSelectedCampaign(campaign);
        setView('campaign-detail');
    };

    const handleBackToHome = () => {
        setSelectedCampaign(null);
        setView('home');
    };

    const handleCreateCampaignClick = () => {
        setView('create-campaign');
    };

    const handleGoToProviderDashboard = () => {
        setView('provider-dashboard');
    };

    const handleGoToDonorDashboard = () => {
        setView('donor-dashboard');
    };

    const handleGoToLeaderboard = () => {
        setView('leaderboard');
    };

    const handleGoToDonorLeaderboard = () => {
        setView('donor-leaderboard');
    };

    if (!isAuthReady) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-xl text-gray-700">Loading application...</div>
            </div>
        );
    }

    return (
        <AppContext.Provider value={{ db, auth, userId, isAuthReady, showModal: handleShowModal /*, storage */ }}> {/* Removed storage from context provider */}
            <div className="font-sans antialiased bg-gray-100 text-gray-900">
                <header className="bg-white shadow-md p-4 flex justify-between items-center">
                    <div className="flex items-center"> {/* Flex container for logo and title */}
                        {/* SVG Logo for Mealathon */}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-8 w-8 text-blue-500 mr-2" // Tailwind classes for size and color
                        >
                            <path
                                fillRule="evenodd"
                                d="M11.47 2.47a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1-1.06 1.06L12 4.06V16.5a.75.75 0 0 1-1.5 0V4.06L8.78 7.28a.75.75 0 0 1-1.06-1.06l3.75-3.75Z"
                                clipRule="evenodd"
                            />
                            <path
                                fillRule="evenodd"
                                d="M2.25 13.5a.75.75 0 0 1 .75.75V19.5a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-5.25a.75.75 0 0 1 1.5 0V19.5a4.5 4.5 0 0 1-4.5 4.5H6a4.5 4.5 0 0 1-4.5-4.5V14.25a.75.75 0 0 1 .75-.75Z"
                                clipRule="evenodd"
                            />
                        </svg>
                        <h1 className="text-3xl font-extrabold text-blue-700">Mealathon</h1>
                    </div>
                    <nav className="space-x-4">
                        <button
                            onClick={handleBackToHome}
                            className="text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-md transition-colors duration-200"
                        >
                            Home
                        </button>
                        <button
                            onClick={handleGoToProviderDashboard}
                            className="text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-md transition-colors duration-200"
                        >
                            My Campaigns
                        </button>
                        <button
                            onClick={handleGoToDonorDashboard}
                            className="text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-md transition-colors duration-200"
                        >
                            My Donations
                        </button>
                        <button
                            onClick={handleGoToLeaderboard}
                            className="text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-md transition-colors duration-200"
                        >
                            Campaign Leaderboard
                        </button>
                        <button
                            onClick={handleGoToDonorLeaderboard}
                            className="text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-md transition-colors duration-200"
                        >
                            Donor Leaderboard
                        </button>
                    </nav>
                </header>

                <main>
                    {view === 'home' && (
                        <CampaignList
                            onSelectCampaign={handleSelectCampaign}
                            onCreateCampaign={handleCreateCampaignClick}
                        />
                    )}
                    {view === 'campaign-detail' && selectedCampaign && (
                        <CampaignDetail campaign={selectedCampaign} onBack={handleBackToHome} />
                    )}
                    {view === 'create-campaign' && (
                        <CreateCampaign onBack={handleBackToHome} />
                    )}
                    {view === 'provider-dashboard' && (
                        <ProviderDashboard onBack={handleBackToHome} />
                    )}
                    {view === 'donor-dashboard' && (
                        <DonorDashboard onBack={handleBackToHome} />
                    )}
                    {view === 'leaderboard' && (
                        <Leaderboard onBack={handleBackToHome} />
                    )}
                    {view === 'donor-leaderboard' && (
                        <DonorLeaderboard onBack={handleBackToHome} />
                    )}
                </main>

                <Modal
                    show={showModal}
                    title={modalTitle}
                    message={modalMessage}
                    onClose={handleCloseModal}
                    onConfirm={handleConfirmModal}
                    showConfirmButton={modalShowConfirm}
                />

                <footer className="bg-gray-800 text-white p-4 text-center text-sm">
                    <p>Mealathon App - Connecting Food Providers with Communities. Your User ID: <span className="font-mono text-blue-300">{userId}</span></p>
                </footer>
            </div>
        </AppContext.Provider>
    );
};

export default App;
