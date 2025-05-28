// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title XBurnNFT
 * @dev ERC721 contract representing locked XBURN positions.
 * Each NFT represents a position where XEN tokens were burned in exchange for XBURN rewards.
 * The NFT contains all the details of the burn and matures after a set time period.
 * Implements EIP-2981 for royalties and OpenSea contract metadata.
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

import "./SVGGenerator.sol";
import "./XBurnMetadata.sol";

using Strings for uint256;

contract XBurnNFT is ERC721, ERC721Enumerable, ERC2981, Ownable {
    // ------------------------------------------------
    // ================ Constants =====================
    // ------------------------------------------------
    
    uint256 public constant MAX_TERM_DAYS = 3650; // ~10 years
    uint256 public constant MAX_BATCH_SIZE = 100; // Maximum batch size for loop protection
    uint256 public constant BASE_RATIO = 1_000_000;
    // ------------------------------------------------
    // ================ State Variables ==============
    // ------------------------------------------------
    
    // Address variables
    address public minter;
    
    // Counter variables
    uint256 private _tokenIdCounter;
    
    // Contract metadata URI for OpenSea, etc.
    string private _contractURI;
    
    // BurnLock struct for storing lock details
    struct BurnLock {
        uint256 xenAmount;      // Amount of XEN tokens burned
        uint256 maturityTs;     // Timestamp when the lock matures
        uint256 ampSnapshot;    // Amplifier snapshot at lock creation
        uint256 termDays;       // Lock term in days
        address owner;          // Owner of the lock
        bool claimed;           // Whether rewards have been claimed
        uint256 rewardAmount;   // Total reward amount (base + bonus)
        uint256 baseMint;       // Base mint amount without amplifier bonus
        
    }

    // tokenId => BurnLock details
    mapping(uint256 => BurnLock) public burnLocks;

    // ------------------------------------------------
    // ================ Custom Errors ================
    // ------------------------------------------------
    
    error OnlyMinter(address caller, address minter);
    error AlreadyClaimed(uint256 tokenId);
    error NonexistentToken(uint256 tokenId);
    error LockedToken(uint256 tokenId);
    error InvalidTermDays(uint256 providedDays, uint256 maxDays);
    error ZeroAddressNotAllowed();
    error NotAuthorized(address caller);
    error BatchSizeTooLarge(uint256 provided, uint256 maximum);
    error RoyaltyTooHigh(uint256 provided, uint256 maximum);
    
    // ------------------------------------------------
    // ================= Events ======================
    // ------------------------------------------------
    
    event BurnLockCreated(
        uint256 indexed tokenId, 
        address indexed user, 
        uint256 amount, 
        uint256 termDays,
        uint256 maturityTimestamp
    );
    
    event MinterChanged(address indexed oldMinter, address indexed newMinter);
    event LockClaimed(uint256 indexed tokenId);
    event LockBurned(uint256 indexed tokenId);
    event ContractURIUpdated(string newURI);
    event RoyaltyInfoUpdated(address receiver, uint96 feeNumerator);

    // ------------------------------------------------
    // ================ Modifiers ====================
    // ------------------------------------------------
    
    /**
     * @dev Restricts function access to only the minter address
     */
    modifier onlyMinter() {
        if (msg.sender != minter) revert OnlyMinter(msg.sender, minter);
        _;
    }

    // ------------------------------------------------
    // ================ Constructor =================
    // ------------------------------------------------
    
    constructor() 
        ERC721("XEN Burn Lock", "XLOCK") 
        Ownable(msg.sender) 
    {
        // Set default royalty to 2.5% to contract owner
        _setDefaultRoyalty(msg.sender, 250);
        
        // Set default contract URI
        _contractURI = "data:application/json;base64,eyJuYW1lIjoiWEVOIEJ1cm4gTG9jayIsImRlc2NyaXB0aW9uIjoiQSBjb2xsZWN0aW9uIG9mIExvY2tlZCBYQlVSTiBwb3NpdGlvbnMgY3JlYXRlZCBieSBidXJuaW5nIFhFTiB0b2tlbnMuIEVhY2ggTkZUIHJlcHJlc2VudHMgYSBsb2NrZWQgcG9zaXRpb24gd2l0aCBldmVyeSBkZXRhaWwgc3RvcmVkIG9uLWNoYWluLiIsImltYWdlIjoiZGF0YTppbWFnZS9zdmcreG1sO2Jhc2U2NCxQSE4yWnlCamJHRnpjejBpWW1GelpTQjBlWEJsTWlJZ1ptbHNiRDBpSTJWa1pXUmxaQ0lnZUcxc2JuTTlJbWgwZEhBNkx5OTNkM2N1ZHpNdWIzSm5Mekl3TURFdmMzWm5JajQ4YzJWamRYSnBkSGtqYzI1c1lYUmxaRDA0Y0hjOEwzTmxZM1Z5YVhSNVBqeHpkSEp2YTJVdGJXbDBaWEp2YVdRK1BDOXpkSEp2YTJVdGJXbDBaWEp2YVdRK1BHRWdjRGtpYzNCc2FYUmxjam93TGpVaVBqeG5JRzltWm5ObGREMGlibTl1WlNJK1BHUnBZV2MrUEd4cGJtViBlREE6ZVRBZ2VESTJORFk6ZVRJMk5EWWlJSE4wZVd4bFBTSjNhV1IwYUhNNk9Dd2liM0JoWTJsMGVUb3hJaUF2UGp4c2FXNWXJER0xPSIsImV4dGVybmFsX2xpbmsiOiJodHRwczovL3hibHVybi5jb20iLCJzZWxsZXJfZmVlX2Jhc2lzX3BvaW50cyI6MjUwLCJmZWVfcmVjaXBpZW50IjoiMHgwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwIn0=";
    }

    // ------------------------------------------------
    // =============== NFT Minting ===================
    // ------------------------------------------------
    
    /**
     * @dev Internal function to create a lock
     * @param tokenId The NFT token ID
     * @param to The address that will own the NFT
     * @param xenAmount Amount of XEN burned
     * @param termDays Lock duration in days
     * @param ampSnapshot Amplifier value at lock creation
     * @param rewardAmount Total reward amount including bonuses
     */
    function _createLock(
        uint256 tokenId,
        address to,
        uint256 xenAmount,
        uint256 termDays,
        uint256 ampSnapshot,
        uint256 rewardAmount
    ) internal {
        // Calculate the base mint amount using the updated constant
        uint256 baseMint = xenAmount / BASE_RATIO; 
        
        // Set maturity timestamp
        uint256 maturityTs;
        if (termDays == 0) {
            // Immediately claimable if term is 0
            maturityTs = block.timestamp;
        } else {
            // Otherwise, add the exact number of days
            maturityTs = block.timestamp + (termDays * 1 days);
        }
            
        // Create the lock
        burnLocks[tokenId] = BurnLock({
            xenAmount: xenAmount,
            maturityTs: maturityTs,
            ampSnapshot: ampSnapshot,
            termDays: termDays,
            owner: to,
            claimed: false,
            rewardAmount: rewardAmount,
            baseMint: baseMint
        });
    }
    
    /**
     * @dev Mints a new XBURN lock NFT
     * @param to Address that will own the NFT
     * @param xenAmount Amount of XEN burned
     * @param termDays Lock duration in days
     * @param ampSnapshot Amplifier value at lock creation
     * @param rewardAmount Total reward amount including bonuses
     * @return tokenId The newly created token ID
     */
    function mint(
        address to,
        uint256 xenAmount,
        uint256 termDays,
        uint256 ampSnapshot,
        uint256 rewardAmount
    ) external onlyMinter returns (uint256) {
        // Validate inputs
        if (termDays > MAX_TERM_DAYS) revert InvalidTermDays(termDays, MAX_TERM_DAYS);
        if (to == address(0)) revert ZeroAddressNotAllowed();
        
        // Create new token ID
        uint256 tokenId = _tokenIdCounter++;
        
        // Create the lock
        _createLock(tokenId, to, xenAmount, termDays, ampSnapshot, rewardAmount);
        
        // Calculate maturity timestamp for the event
        uint256 maturityTs = termDays == 0 
            ? block.timestamp 
            : block.timestamp + (termDays * 1 days);
            
        // Emit event for indexing and tracking
        emit BurnLockCreated(tokenId, to, xenAmount, termDays, maturityTs);
        
        // Mint the NFT
        _safeMint(to, tokenId);
        
        return tokenId;
    }

    // ------------------------------------------------
    // ============= Lock Management =================
    // ------------------------------------------------
    
    /**
     * @dev Marks a lock as claimed
     * @param tokenId The token ID to update
     */
    function setClaimed(uint256 tokenId) external onlyMinter {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
        if (burnLocks[tokenId].claimed) revert AlreadyClaimed(tokenId);
        
        burnLocks[tokenId].claimed = true;
        emit LockClaimed(tokenId);
    }

    /**
     * @dev Burns an NFT (typically after claiming)
     * @param tokenId The token ID to burn
     */
    function burn(uint256 tokenId) external onlyMinter {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
        
        _burn(tokenId);
        emit LockBurned(tokenId);
    }

    // ------------------------------------------------
    // ================ Views ========================
    // ------------------------------------------------
    
    /**
     * @dev Gets all details for a specific lock
     * @param tokenId The token ID to query
     * @return xenAmount Amount of XEN burned
     * @return maturityTs Maturity timestamp
     * @return ampSnapshot Amplifier snapshot
     * @return termDays Lock term in days
     * @return claimed Whether rewards have been claimed
     * @return rewardAmount Total reward amount
     * @return baseMint Base mint amount
     * @return owner Owner of the lock
     */
    function getLockDetails(uint256 tokenId)
        external
        view
        returns (
            uint256 xenAmount,
            uint256 maturityTs,
            uint256 ampSnapshot,
            uint256 termDays,
            bool claimed,
            uint256 rewardAmount,
            uint256 baseMint,
            address owner
        )
    {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
        
        BurnLock storage lock = burnLocks[tokenId];
        return (
            lock.xenAmount,
            lock.maturityTs,
            lock.ampSnapshot,
            lock.termDays,
            lock.claimed,
            lock.rewardAmount,
            lock.baseMint,
            lock.owner
        );
    }

    /**
     * @dev Gets all lock token IDs owned by a specific user with pagination
     * @param user Address to query
     * @param page Page number (0-indexed)
     * @param pageSize Number of items per page
     * @return tokenIds Array of token IDs
     * @return totalPages Total number of pages available
     */
    function getAllUserLocks(address user, uint256 page, uint256 pageSize) 
        external 
        view 
        returns (uint256[] memory tokenIds, uint256 totalPages) 
    {
        // Protect against excessively large page sizes
        if (pageSize > MAX_BATCH_SIZE) revert BatchSizeTooLarge(pageSize, MAX_BATCH_SIZE);
        
        uint256 balance = balanceOf(user);

        // Calculate total pages with ceiling division
        totalPages = (balance + pageSize - 1) / pageSize;

        // Handle out of bounds pages
        if (page >= totalPages || balance == 0) {
            return (new uint256[](0), totalPages);
        }

        // Calculate actual page boundaries
        uint256 startIndex = page * pageSize;
        uint256 endIndex = startIndex + pageSize;
        if (endIndex > balance) {
            endIndex = balance;
        }

        // Create result array
        tokenIds = new uint256[](endIndex - startIndex);
        
        // Fill array with token IDs
        for (uint256 i = startIndex; i < endIndex; ++i) {
            tokenIds[i - startIndex] = tokenOfOwnerByIndex(user, i);
        }
        
        return (tokenIds, totalPages);
    }

    /**
     * @dev Returns metadata URI for a token
     * Uses the XBurnMetadata library to construct the URI.
     * @param tokenId The token ID to query
     * @return URI string with embedded metadata
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721) // Only override ERC721
        returns (string memory)
    {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);

        // Get lock data directly
        BurnLock storage lock = burnLocks[tokenId];

        // Use the library to construct the full token URI
        // Note: Mapping the internal BurnLock struct to the library's version
        return XBurnMetadata.constructTokenURI(
            tokenId,
            XBurnMetadata.BurnLock({
                xenAmount: lock.xenAmount,
                maturityTs: lock.maturityTs,
                ampSnapshot: lock.ampSnapshot,
                termDays: lock.termDays,
                owner: _ownerOf(tokenId), // Use _ownerOf for current owner safety
                claimed: lock.claimed,
                rewardAmount: lock.rewardAmount,
                baseMint: lock.baseMint
            }),
            block.timestamp,
            address(this)
        );
    }

    // ------------------------------------------------
    // ================ Royalty Support ==============
    // ------------------------------------------------

    /**
     * @dev Returns the contract-level metadata URI for marketplaces (OpenSea, etc.)
     * @return Contract URI string
     */
    function contractURI() public view returns (string memory) {
        return _contractURI;
    }
    
    /**
     * @dev Sets the contract-level metadata URI
     * @param newURI New contract URI
     */
    function setContractURI(string memory newURI) external onlyOwner {
        _contractURI = newURI;
        emit ContractURIUpdated(newURI);
    }
    
    /**
     * @dev Sets a new royalty receiver and fee
     * @param receiver Address to receive royalties
     * @param feeNumerator Fee in basis points (e.g., 250 = 2.5%)
     */
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        if (feeNumerator > 1000) revert RoyaltyTooHigh(feeNumerator, 1000); // Max 10%
        _setDefaultRoyalty(receiver, feeNumerator);
        emit RoyaltyInfoUpdated(receiver, feeNumerator);
    }
    
    /**
     * @dev Removes the default royalty configuration
     */
    function deleteDefaultRoyalty() external onlyOwner {
        _deleteDefaultRoyalty();
        emit RoyaltyInfoUpdated(address(0), 0);
    }

    // ------------------------------------------------
    // ================ Admin Functions ==============
    // ------------------------------------------------
    
    /**
     * @dev Sets the minter address
     * @param newMinter The new minter address
     */
    function setMinter(address newMinter) public {
        if (msg.sender != minter && msg.sender != owner() && minter != address(0)) {
            revert NotAuthorized(msg.sender);
        }
        if (newMinter == address(0)) revert ZeroAddressNotAllowed();
        
        address oldMinter = minter;
        minter = newMinter;
        
        emit MinterChanged(oldMinter, newMinter);
    }

    // ------------------------------------------------
    // ============ Internal Overrides ===============
    // ------------------------------------------------

    /**
     * @dev Update hook from ERC721
     * Updates owner in burnLocks when token is transferred
     * @param to Address receiving the token
     * @param tokenId Token ID being transferred
     * @param auth Address authorized to make the transfer
     * @return from Address that previously owned the token
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override(ERC721, ERC721Enumerable) returns (address) {
        address from = super._update(to, tokenId, auth);
        
        // Update owner in burnLocks when transferring
        if (from != address(0) && to != address(0)) {
            // Prevent transfer of claimed tokens
            if (burnLocks[tokenId].claimed) revert LockedToken(tokenId);
            
            // Update ownership record in the lock struct itself
            burnLocks[tokenId].owner = to;
        }
        
        return from;
    }

    /**
     * @dev Required override for ERC721Enumerable
     * @param account Address to increase balance for
     * @param value Amount to increase balance by
     */
    function _increaseBalance(
        address account,
        uint128 value
    ) internal virtual override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    /**
     * @dev Required override for interface support including EIP-2981
     * @param interfaceId Interface identifier
     * @return bool True if supported
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC721, ERC721Enumerable, ERC2981) returns (bool) {
        // Use super call for cleaner inheritance check
        return super.supportsInterface(interfaceId);
    }
}