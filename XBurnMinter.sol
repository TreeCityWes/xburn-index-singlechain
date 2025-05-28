// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title XBurnMinter
 * @dev Main contract for burning XEN tokens to get XBURN tokens.
 * Creates NFTs representing locked positions and handles reward distribution.
 * Optimized for gas efficiency and security.
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

import {XBurnNFT} from "./XBurnNFT.sol";

// ------------------------------------------------
// ================ Interfaces ===================
// ------------------------------------------------

/**
 * @dev Interface for tokens that can be burned
 */
interface IBurnableToken {
    function burn(address account, uint256 amount) external;
}

/**
 * @dev Interface for contracts that receive burn callbacks
 */
interface IBurnRedeemable {
    function onTokenBurned(address user, uint256 amount) external;
}

/**
 * @dev Extended interface for XBURN token
 */
interface IXBURN is IERC20 {
    function mint(address to, uint256 amount) external;
    function burn(address account, uint256 amount) external;
}

/**
 * @dev Extended interface for Uniswap V2 pairs
 */
interface IUniswapV2PairExtended is IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/**
 * @dev Interface for XBurnNFT contract
 */
interface IXBurnNFT {
    function mint(
        address to,
        uint256 xenAmount,
        uint256 termDays,
        uint256 ampSnapshot,
        uint256 rewardAmount
    ) external returns (uint256);

    function setClaimed(uint256 tokenId) external;
    function burn(uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);

    function getLockDetails(uint256 tokenId) external view returns (
        uint256 xenAmount,
        uint256 maturityTs,
        uint256 ampSnapshot,
        uint256 termDays,
        bool claimed,
        uint256 rewardAmount,
        uint256 baseMint,
        address owner
    );

    function getAllUserLocks(address user, uint256 page, uint256 pageSize) external view returns (uint256[] memory, uint256 totalPages);
    function setMinter(address newMinter) external;
}

/**
 * @title XBurnMinter
 * @dev Main contract for burning XEN tokens and minting XBURN tokens
 */
contract XBurnMinter is ERC20, Ownable, ReentrancyGuard, IBurnRedeemable, IERC165 {
    using SafeERC20 for IERC20;

    // ------------------------------------------------
    // ================ Constants ====================
    // ------------------------------------------------

    uint256 public constant AMP_START = 2397;
    uint256 public constant AMP_END = 1;
    uint256 public constant BASE_RATIO = 1_000_000; // 1M XEN = 1 XBURN (Updated)
    uint256 public constant MIN_TERM = 1 days;
    uint256 public constant MAX_TERM = 3650 days; // ~10 years
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10**18;
    uint256 public constant SWAP_THRESHOLD = 500_000_000 * 1e18; // Mainnet: 500M XEN
    uint256 public constant CALLER_REWARD_PERCENTAGE = 5;
    uint256 public constant MAX_DEADLINE = 15 minutes;
    uint256 public constant MINIMUM_LIQUIDITY = 100_000 * 1e18;
    uint256 public constant MAX_BATCH_SIZE = 50; // Re-added: Maximum batch size for view function loops

    // ------------------------------------------------
    // ================ State Variables ==============
    // ------------------------------------------------

    // External contract references (immutable for gas savings)
    IERC20 public immutable XEN;
    XBurnNFT public immutable nftContract;
    IUniswapV2Router02 public immutable uniswapRouter;
    uint256 public immutable LAUNCH_TS; // Timestamp when contract was launched

    // Tracking state variables (uint256 grouped together for storage optimization)
    uint256 public globalBurnRank; // Number of burning participants
    uint256 public totalXenBurned;
    uint256 public totalXburnMinted;
    uint256 public totalXburnBurned;
    uint256 public pendingXen;     // XEN waiting to be swapped
    
    // Address variables
    address public liquidityPair;  // Uniswap pair address
    
    // Boolean variables
    bool public liquidityInitialized;
    
    // Mappings
    mapping(address => uint256) public userXenBurned;
    mapping(address => uint256) public userXburnMinted;
    mapping(address => uint256) public userXburnBurned;

    // ------------------------------------------------
    // ================ Custom Errors ================
    // ------------------------------------------------

    error LiquidityAlreadyInitialized();
    error InsufficientXen(uint256 required, uint256 provided);
    error LiquidityPairNotSet();
    error LiquidityNotInitialized();
    error PendingXenTooLow(uint256 current, uint256 required);
    error SwapFailedError(string reason);
    error InvalidAmount(uint256 amount);
    error InvalidTerm(uint256 providedDays, uint256 maxDays);
    error NotTokenOwner(uint256 tokenId, address provided, address actual);
    error TokenNotClaimable(uint256 tokenId);
    error TokenAlreadyClaimed(uint256 tokenId);
    error TokenNotMatured(uint256 tokenId, uint256 maturityTs, uint256 currentTime);
    error UnauthorizedCallback(address sender, address expected);

    // ------------------------------------------------
    // ================== Events =====================
    // ------------------------------------------------

    event XENBurned(address indexed user, uint256 amount);
    event XBURNClaimed(address indexed user, uint256 baseAmount, uint256 bonusAmount);
    event EmergencyEnd(address indexed user, uint256 baseAmount);
    event GlobalStatsUpdated(uint256 totalXenBurned, uint256 totalXburnMinted);
    event XBURNBurned(address indexed user, uint256 amount);
    event CallerRewarded(address indexed caller, uint256 amount);
    event SwapFailed(string reason, string message, uint256 xenAmount);
    event BurnNFTMinted(address indexed user, uint256 tokenId, uint256 xenAmount, uint256 termDays);
    event LiquidityInitialized(uint256 amountXBURN, uint256 amountXEN, uint256 liquidity);

    // ------------------------------------------------
    // ================ Constructor =================
    // ------------------------------------------------

    /**
     * @dev Initializes the contract
     * @param _xen XEN token address
     * @param _router Uniswap router address
     * @param _nft XBurnNFT contract address
     */
    constructor(
        address _xen,
        address _router,
        address _nft
    ) ERC20("XBURN", "XBURN") Ownable(msg.sender) {
        // Initialize constants
        LAUNCH_TS = block.timestamp;
        globalBurnRank = 1;
        
        // Store contract references
        XEN = IERC20(_xen);
        uniswapRouter = IUniswapV2Router02(_router);
        nftContract = XBurnNFT(_nft);

        // Mint initial supply to this contract
        _mint(address(this), INITIAL_SUPPLY);
    }

    // ------------------------------------------------
    // ================ Liquidity ====================
    // ------------------------------------------------

    /**
     * @dev Initializes liquidity in Uniswap
     * @param xenAmount Amount of XEN to provide for liquidity
     */
    function initializeLiquidity(uint256 xenAmount) external onlyOwner nonReentrant {
        if (liquidityInitialized) revert LiquidityAlreadyInitialized();
        if (xenAmount < MINIMUM_LIQUIDITY) revert InsufficientXen(MINIMUM_LIQUIDITY, xenAmount);
        if (XEN.balanceOf(msg.sender) < xenAmount) revert InsufficientXen(xenAmount, XEN.balanceOf(msg.sender));

        // Transfer XEN to this contract
        XEN.safeTransferFrom(msg.sender, address(this), xenAmount);

        // Approve tokens for Uniswap router
        _approve(address(this), address(uniswapRouter), INITIAL_SUPPLY);
        XEN.approve(address(uniswapRouter), xenAmount);

        // Add liquidity
        _doAddLiquidity(xenAmount);
    }

    /**
     * @dev Helper to add liquidity (reduces stack depth)
     * @param xenAmount Amount of XEN to provide
     */
    function _doAddLiquidity(uint256 xenAmount) private {
        (uint256 xburnUsed, uint256 xenUsed, uint256 liquidity) = uniswapRouter.addLiquidity(
            address(this),
            address(XEN),
            INITIAL_SUPPLY,
            xenAmount,
            (INITIAL_SUPPLY * 95) / 100, // Allow 5% slippage
            (xenAmount * 95) / 100,      // Allow 5% slippage
            msg.sender,                   // LP tokens to owner
            block.timestamp + MAX_DEADLINE
        );

        // Ensure liquidity was created successfully
        if (liquidity == 0) revert InsufficientXen(MINIMUM_LIQUIDITY, xenAmount);
        
        // Get the pair address from factory
        liquidityPair = IUniswapV2Factory(uniswapRouter.factory()).getPair(address(this), address(XEN));
        if (liquidityPair == address(0)) revert LiquidityPairNotSet();
        
        // Mark as initialized
        liquidityInitialized = true;
        
        // Emit event
        emit LiquidityInitialized(xburnUsed, xenUsed, liquidity);
    }

    // ------------------------------------------------
    // ================ Swapping ====================
    // ------------------------------------------------

    /**
     * @dev Swaps accumulated XEN for XBURN and burns it
     * @param minXburnReceived Minimum amount of XBURN to receive
     */
    function swapXenForXburn(uint256 minXburnReceived) external nonReentrant {
        if (!liquidityInitialized) revert LiquidityNotInitialized();
        if (liquidityPair == address(0)) revert LiquidityPairNotSet();
        if (pendingXen < SWAP_THRESHOLD) revert PendingXenTooLow(pendingXen, SWAP_THRESHOLD);

        // Get amount to swap and reset pending counter
        uint256 xenToSwap = pendingXen;
        pendingXen = 0;

        // Execute swap
        _executeSwap(xenToSwap, minXburnReceived);
    }

    /**
     * @dev Helper to execute the swap (reduces stack depth)
     * @param xenToSwap Amount of XEN to swap
     * @param minXburnReceived Minimum amount of XBURN to receive
     */
    function _executeSwap(uint256 xenToSwap, uint256 minXburnReceived) private {
        // Calculate caller reward
        uint256 callerReward = (xenToSwap * CALLER_REWARD_PERCENTAGE) / 100;
        uint256 xenForSwap = xenToSwap - callerReward;
        
        // Send reward to caller
        XEN.safeTransfer(msg.sender, callerReward);
        emit CallerRewarded(msg.sender, callerReward);

        // Set up swap path
        address[] memory path = new address[](2);
        path[0] = address(XEN);
        path[1] = address(this);

        // Approve router to spend XEN
        XEN.safeIncreaseAllowance(address(uniswapRouter), xenForSwap);

        // Execute swap with try/catch for safety
        try uniswapRouter.swapExactTokensForTokens(
            xenForSwap,
            minXburnReceived,
            path,
            msg.sender,  // Changed: Send to caller first, not contract
            block.timestamp + MAX_DEADLINE
        ) returns (uint256[] memory amounts) {
            uint256 xburnReceived = amounts[1];
            
            // Transfer tokens back to contract
            _transfer(msg.sender, address(this), xburnReceived);
            
            // Burn the received XBURN tokens
            _burn(address(this), xburnReceived);
            totalXburnBurned += xburnReceived;
            
            // Add event to match old contract
            emit XBURNBurned(address(this), xburnReceived);
        } catch Error(string memory reason) {
            // Revert pendingXen if swap fails
            pendingXen = xenToSwap;
            emit SwapFailed("Swap transaction failed", reason, xenToSwap);
            revert SwapFailedError(reason);
        } catch {
            // Revert pendingXen if swap fails with no reason
            pendingXen = xenToSwap;
            emit SwapFailed("Swap transaction failed", "Unknown error", xenToSwap);
            revert SwapFailedError("Unknown error");
        }
    }

    // ------------------------------------------------
    // ============== Main Burn Logic ================
    // ------------------------------------------------

    /**
     * @dev Calculates reward amount based on base, amplifier, and term
     * @param baseAmount Base amount of XBURN
     * @param ampSnapshot Amplifier snapshot value
     * @param termDays Term duration in days
     * @return Total reward amount
     */
    function _calculateReward(
        uint256 baseAmount, 
        uint256 ampSnapshot, 
        uint256 termDays
    ) private pure returns (uint256) {
        // Calculate percentage scaled up to MAX_TERM (3650 days)
        uint256 termPercentage = (termDays * 100) / (MAX_TERM / 1 days); // Use MAX_TERM constant
        uint256 ampPercentage = (ampSnapshot * 100) / AMP_START;  // 0-100
        
        // Calculate bonus (up to 100% based on term and amp)
        uint256 bonus = (baseAmount * termPercentage * ampPercentage) / 10000;
        
        return baseAmount + bonus;
    }

    /**
     * @dev Burns XEN tokens to mint XBURN (locked in an NFT)
     * @param amount Amount of XEN to burn (in wei)
     * @param termDays Lock duration in days
     */
    function burnXEN(uint256 amount, uint256 termDays) external nonReentrant {
        // Corrected Check: Ensure at least BASE_RATIO *full* XEN tokens are burned
        if (amount < BASE_RATIO * 1e18) revert InvalidAmount(amount); 
        if (termDays * 1 days > MAX_TERM) revert InvalidTerm(termDays, MAX_TERM / 1 days);
        
        // Step 1: Handle XEN tokens (burn + accumulate)
        _handleXenTokens(amount);
        
        // Step 2: Create NFT representing the locked position
        _createBurnNFT(amount, termDays);
    }

    /**
     * @dev Helper to handle XEN tokens during burn (reduces stack depth)
     * @param amount Total amount of XEN to handle
     */
    function _handleXenTokens(uint256 amount) private {
        // Split: 80% burned directly, 20% accumulated for later swaps
        uint256 xenForAccumulation = (amount * 20) / 100;
        uint256 xenForBurn = amount - xenForAccumulation;
        
        // Transfer accumulation portion to contract
        XEN.safeTransferFrom(msg.sender, address(this), xenForAccumulation);
        pendingXen += xenForAccumulation;
        
        // Burn directly from user's address
        IBurnableToken(address(XEN)).burn(msg.sender, xenForBurn);
        
        // Update stats
        totalXenBurned += amount;
        userXenBurned[msg.sender] += amount;
    }

    /**
     * @dev Helper to create NFT during burn (reduces stack depth)
     * @param amount Amount of XEN burned
     * @param termDays Lock duration in days
     */
    function _createBurnNFT(uint256 amount, uint256 termDays) private {
        // Calculate reward values
        uint256 baseAmount = amount / BASE_RATIO;
        uint256 ampSnapshot = _currentAMP();
        uint256 rewardAmount = _calculateReward(baseAmount, ampSnapshot, termDays);
        
        // Create NFT lock
        uint256 tokenId = nftContract.mint(
            msg.sender,   // NFT owner
            amount,       // Original XEN amount
            termDays,     // Term days
            ampSnapshot,  // Current amplifier snapshot
            rewardAmount  // Total reward amount including bonus
        );
        
        // Increase global burn rank
        globalBurnRank++;
        
        // Emit events
        emit XENBurned(msg.sender, amount);
        emit BurnNFTMinted(msg.sender, tokenId, amount, termDays);
        emit GlobalStatsUpdated(totalXenBurned, totalXburnMinted);
    }

    // ------------------------------------------------
    // ============== Claiming Lock Logic =============
    // ------------------------------------------------

    /**
     * @dev XEN burn callback implementation
     * Required by IBurnRedeemable interface
     * @param user Address of the user who burned tokens
     * @param amount Amount of tokens burned
     */
    function onTokenBurned(address user, uint256 amount) external override {
        // Only XEN contract can call this function
        if (msg.sender != address(XEN)) revert UnauthorizedCallback(msg.sender, address(XEN));
    }

    /**
     * @dev ERC165 interface support
     * @param interfaceId Interface identifier to check
     * @return bool True if this contract supports the interface
     */
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return 
            interfaceId == type(IBurnRedeemable).interfaceId || 
            interfaceId == type(IERC165).interfaceId;
    }

    /**
     * @dev Claims XBURN rewards from a mature lock
     * @param tokenId NFT token ID to claim
     */
    function claimLockedXBURN(uint256 tokenId) external nonReentrant {
        // Validate ownership
        address owner = nftContract.ownerOf(tokenId);
        if (owner != msg.sender) revert NotTokenOwner(tokenId, msg.sender, owner);

        // Validate token is claimable
        (bool isValid, uint256 xenAmount, uint256 rewardAmount) = _validateTokenForClaim(tokenId);
        if (!isValid) revert TokenNotClaimable(tokenId);

        // Process the claim
        _processClaim(tokenId, xenAmount, rewardAmount);
    }

    /**
     * @dev Helper to validate a token for claiming (reduces stack depth)
     * @param tokenId NFT token ID to validate
     * @return isValid Whether the token is valid for claiming
     * @return xenAmount Amount of XEN burned
     * @return rewardAmount Total reward amount
     */
    function _validateTokenForClaim(uint256 tokenId) private view returns (
        bool isValid,
        uint256 xenAmount,
        uint256 rewardAmount
    ) {
        uint256 maturityTs;
        bool claimed;
        uint256 baseMint;
        address owner;
        uint256 ampSnapshot;
        uint256 termDays;
        
        (
            xenAmount,
            maturityTs,
            ampSnapshot,
            termDays,
            claimed,
            rewardAmount,
            baseMint,
            owner
        ) = nftContract.getLockDetails(tokenId);

        // Token is valid if not claimed and matured
        isValid = !claimed && block.timestamp >= maturityTs;
        
        return (isValid, xenAmount, rewardAmount);
    }

    /**
     * @dev Helper to process a claim (reduces stack depth)
     * @param tokenId NFT token ID to process
     * @param xenAmount Amount of XEN burned
     * @param rewardAmount Total reward amount
     */
    function _processClaim(
        uint256 tokenId, 
        uint256 xenAmount, 
        uint256 rewardAmount
    ) private {
        // Mint the reward to the claimer
        _mint(msg.sender, rewardAmount);
        
        // Update stats
        totalXburnMinted += rewardAmount;
        userXburnMinted[msg.sender] += rewardAmount;

        // Mark NFT as claimed and burn it
        nftContract.setClaimed(tokenId);
        nftContract.burn(tokenId);

        // Calculate base amount for event
        uint256 baseAmount = xenAmount / BASE_RATIO;
        
        // Emit events
        emit XBURNClaimed(msg.sender, baseAmount, rewardAmount - baseAmount);
        emit GlobalStatsUpdated(totalXenBurned, totalXburnMinted);
    }

    /**
     * @dev Emergency withdrawal with reduced rewards
     * @param tokenId NFT token ID to emergency withdraw
     */
    function emergencyEnd(uint256 tokenId) external nonReentrant {
        // Verify ownership
        address owner = nftContract.ownerOf(tokenId);
        if (owner != msg.sender) revert NotTokenOwner(tokenId, msg.sender, owner);

        // Validate token
        bool isValid = false;
        uint256 baseMint = 0;
        (isValid, baseMint) = _validateEmergencyEnd(tokenId);
        if (!isValid) revert TokenNotClaimable(tokenId);

        // Process emergency end
        _processEmergencyEnd(tokenId, baseMint);
    }

    /**
     * @dev Helper to validate emergency end (reduces stack depth)
     * @param tokenId NFT token ID to validate
     * @return isValid Whether token is valid for emergency end
     * @return baseMint Base mint amount (no bonus)
     */
    function _validateEmergencyEnd(uint256 tokenId) private view returns (bool isValid, uint256 baseMint) {
        uint256 xenAmount;
        uint256 maturityTs;
        uint256 ampSnapshot;
        uint256 termDays;
        bool claimed;
        uint256 rewardAmount;
        address tokenOwner;
        
        (
            xenAmount,
            maturityTs,
            ampSnapshot,
            termDays,
            claimed,
            rewardAmount,
            baseMint,
            tokenOwner
        ) = nftContract.getLockDetails(tokenId);

        // Valid if not claimed (any maturity date)
        isValid = !claimed;
        
        return (isValid, baseMint);
    }

    /**
     * @dev Helper to process emergency end (reduces stack depth)
     * @param tokenId NFT token ID to process
     * @param baseMint Base mint amount to return
     */
    function _processEmergencyEnd(uint256 tokenId, uint256 baseMint) private {
        // Mint only the base amount (no bonus)
        _mint(msg.sender, baseMint);
        
        // Update stats
        totalXburnMinted += baseMint;
        userXburnMinted[msg.sender] += baseMint;

        // Mark as claimed and burn NFT
        nftContract.setClaimed(tokenId);
        nftContract.burn(tokenId);

        // Emit events
        emit EmergencyEnd(msg.sender, baseMint);
        emit GlobalStatsUpdated(totalXenBurned, totalXburnMinted);
    }

    // ------------------------------------------------
    // ================ Burn XBURN ===================
    // ------------------------------------------------

    /**
     * @dev Burns XBURN tokens
     * @param amount Amount to burn
     */
    function burnXburn(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount(amount);
        
        // Burn from sender
        _burn(msg.sender, amount);
        
        // Update stats
        totalXburnBurned += amount;
        userXburnBurned[msg.sender] += amount;

        // Emit event
        emit XBURNBurned(msg.sender, amount);
    }

    // ------------------------------------------------
    // ================ View Functions ===============
    // ------------------------------------------------

    /**
     * @dev Gets user's locked tokens with pagination
     * @param user Address to query
     * @param page Page number (0-indexed)
     * @param pageSize Number of items per page
     * @return tokenIds Array of token IDs owned by user
     * @return totalPages Total number of pages
     */
    function getUserLocks(address user, uint256 page, uint256 pageSize) 
        public 
        view 
        returns (uint256[] memory tokenIds, uint256 totalPages) 
    {
        // Limit page size for gas optimization
        if (pageSize > MAX_BATCH_SIZE) {
            pageSize = MAX_BATCH_SIZE;
        }
        
        // Forward request to the NFT contract
        return nftContract.getAllUserLocks(user, page, pageSize);
    }

    /**
     * @dev Gets first page of user's locked tokens (convenience function)
     * @param user Address to query
     * @return Array of token IDs owned by user (first page)
     */
    function getUserLocks(address user) external view returns (uint256[] memory) {
        (uint256[] memory tokenIds, ) = getUserLocks(user, 0, 10); // Default: page 0, size 10
        return tokenIds;
    }

    /**
     * @dev Gets comprehensive user stats
     * @param user Address to query
     * @return userXenBurnedAmount Total XEN burned by user
     * @return userXburnBurnedAmount Total XBURN burned by user
     * @return userXburnBalance Current XBURN balance
     * @return userBurnPercentage User's percentage of total XEN burned
     * @return globalXenBurned Total XEN burned across all users
     * @return globalXburnBurned Total XBURN burned across all users
     * @return totalXburnSupply Current total XBURN supply
     * @return globalBurnPercentage Percentage of total XBURN burned
     */
    function getStats(address user) external view returns (
        uint256 userXenBurnedAmount,
        uint256 userXburnBurnedAmount,
        uint256 userXburnBalance,
        uint256 userBurnPercentage,
        uint256 globalXenBurned,
        uint256 globalXburnBurned,
        uint256 totalXburnSupply,
        uint256 globalBurnPercentage
    ) {
        // Get basic stats
        userXenBurnedAmount = userXenBurned[user];
        userXburnBurnedAmount = userXburnBurned[user];
        userXburnBalance = balanceOf(user);
        globalXenBurned = totalXenBurned;
        globalXburnBurned = totalXburnBurned;
        totalXburnSupply = totalSupply();
        
        // Calculate percentages
        (userBurnPercentage, globalBurnPercentage) = _calculatePercentages(user, totalXburnSupply);
        
        return (
            userXenBurnedAmount,
            userXburnBurnedAmount,
            userXburnBalance,
            userBurnPercentage,
            globalXenBurned,
            globalXburnBurned,
            totalXburnSupply,
            globalBurnPercentage
        );
    }

    /**
     * @dev Helper function to calculate percentages
     * @param user Address to calculate percentages for
     * @param supply Total XBURN supply
     * @return userBurnPercentage User's percentage of total XEN burned (basis points)
     * @return globalBurnPercentage Percentage of total XBURN burned (basis points)
     */
    function _calculatePercentages(address user, uint256 supply) private view returns (
        uint256 userBurnPercentage, 
        uint256 globalBurnPercentage
    ) {
        userBurnPercentage = totalXenBurned > 0 
            ? (userXenBurned[user] * 10000) / totalXenBurned
            : 0;

        globalBurnPercentage = supply > 0
            ? (totalXburnBurned * 10000) / supply
            : 0;
            
        return (userBurnPercentage, globalBurnPercentage);
    }

    /**
     * @dev Gets detailed stats about a specific token
     * @param tokenId NFT token ID to query
     * @return xenAmount Amount of XEN burned
     * @return baseMint Base mint amount
     * @return rewardAmount Total reward amount
     * @return maturityTs Maturity timestamp
     * @return isClaimable Whether token is currently claimable
     * @return isClaimed Whether token has been claimed
     */
    function getTokenStats(uint256 tokenId) external view returns (
        uint256 xenAmount,
        uint256 baseMint,
        uint256 rewardAmount,
        uint256 maturityTs,
        bool isClaimable,
        bool isClaimed
    ) {
        uint256 ampSnapshot;
        uint256 termDays;
        address tokenOwner;
        
        (
            xenAmount,
            maturityTs,
            ampSnapshot,
            termDays,
            isClaimed,
            rewardAmount,
            baseMint,
            tokenOwner
        ) = nftContract.getLockDetails(tokenId);
        
        isClaimable = !isClaimed && block.timestamp >= maturityTs;
        
        return (xenAmount, baseMint, rewardAmount, maturityTs, isClaimable, isClaimed);
    }

    /**
     * @dev Gets key stats for a user
     * @param user Address to query
     * @return xenBurned Total XEN burned by user
     * @return xburnBalance Current XBURN balance
     * @return totalTokens Total NFTs owned by user
     * @return claimableTokens Number of NFTs that are claimable
     */
    function getUserStats(address user) external view returns (
        uint256 xenBurned,
        uint256 xburnBalance,
        uint256 totalTokens,
        uint256 claimableTokens
    ) {
        // Get basic stats
        xenBurned = userXenBurned[user];
        xburnBalance = balanceOf(user);
        
        // Get tokens and count claimable tokens
        (totalTokens, claimableTokens) = _countUserTokens(user);
        
        return (xenBurned, xburnBalance, totalTokens, claimableTokens);
    }

    /**
     * @dev Helper function to count user tokens with gas optimization
     * @param user Address to count tokens for
     * @return totalTokens Total NFTs owned by user
     * @return claimableTokens Number of NFTs that are claimable
     */
    function _countUserTokens(address user) private view returns (uint256 totalTokens, uint256 claimableTokens) {
        // Get total tokens owned (first page only, limited to MAX_BATCH_SIZE)
        (uint256[] memory tokens, ) = nftContract.getAllUserLocks(user, 0, MAX_BATCH_SIZE);
        totalTokens = tokens.length;
        
        // Count claimable tokens (with gas limit protection)
        claimableTokens = 0;
        uint256 loopLimit = tokens.length > MAX_BATCH_SIZE ? MAX_BATCH_SIZE : tokens.length;
        
        for (uint256 i = 0; i < loopLimit; i++) {
            uint256 xenAmount;
            uint256 maturityTs;
            uint256 ampSnapshot;
            uint256 termDays;
            bool claimed;
            uint256 rewardAmount;
            uint256 baseMint;
            address tokenOwner;
            
            (
                xenAmount,
                maturityTs,
                ampSnapshot,
                termDays,
                claimed,
                rewardAmount,
                baseMint,
                tokenOwner
            ) = nftContract.getLockDetails(tokens[i]);
            
            if (!claimed && block.timestamp >= maturityTs) {
                claimableTokens++;
            }
        }
        
        return (totalTokens, claimableTokens);
    }

    /**
     * @dev Validates that the liquidity pair tokens are correct
     * @return bool True if liquidity pair tokens are correct
     */
    function validatePairTokens() external view returns (bool) {
        if (liquidityPair == address(0)) return false;

        address token0 = IUniswapV2PairExtended(liquidityPair).token0();
        address token1 = IUniswapV2PairExtended(liquidityPair).token1();

        return (token0 == address(this) && token1 == address(XEN)) ||
               (token0 == address(XEN) && token1 == address(this));
    }

    // ------------------------------------------------
    // ================ Internal Functions ===========
    // ------------------------------------------------

    /**
     * @dev Gets current amplifier value based on days since launch
     * @return Current amplifier value
     */
    function _currentAMP() private view returns (uint256) {
        uint256 daysActive = (block.timestamp - LAUNCH_TS) / 1 days;
        if (daysActive >= AMP_START) {
            return AMP_END;
        }
        return AMP_START - daysActive;
    }

    /**
     * @dev Verifies amplifier calculation for a given number of days
     * @param daysFromLaunch Days since launch to calculate for
     * @return Amplifier value at the specified day
     */
    function verifyAmpCalculation(uint256 daysFromLaunch) external view returns (uint256) {
        if (daysFromLaunch >= AMP_START) {
            return AMP_END;
        }
        return AMP_START - daysFromLaunch;
    }

    // ------------------------------------------------
    // ============== Global Stats View ==============
    // ------------------------------------------------

    /**
     * @dev Gets global protocol stats
     * @return currentAMP Current amplifier value
     * @return daysSinceLaunch Days since protocol launch
     * @return totalBurnedXEN Total XEN burned across all users
     * @return totalMintedXBURN Total XBURN minted
     * @return ampDecayDaysLeft Days until amplifier reaches minimum
     */
    function getGlobalStats() external view returns (
        uint256 currentAMP,
        uint256 daysSinceLaunch,
        uint256 totalBurnedXEN,
        uint256 totalMintedXBURN,
        uint256 ampDecayDaysLeft
    ) {
        currentAMP = _currentAMP();
        daysSinceLaunch = (block.timestamp - LAUNCH_TS) / 1 days;
        totalBurnedXEN = totalXenBurned;
        totalMintedXBURN = totalXburnMinted;
        ampDecayDaysLeft = currentAMP > AMP_END ? currentAMP - AMP_END : 0;
    }

    /**
     * @dev Gets progress towards next swap
     * @return accumulated Amount of XEN accumulated for swapping
     * @return threshold Threshold required for swap
     * @return percentage Percentage progress towards threshold (basis points)
     */
    function getAccumulationProgress() external view returns (
        uint256 accumulated,
        uint256 threshold,
        uint256 percentage
    ) {
        accumulated = pendingXen;
        threshold = SWAP_THRESHOLD;
        percentage = accumulated > 0 
            ? (accumulated * 10000) / threshold 
            : 0;
        return (accumulated, threshold, percentage);
    }
}