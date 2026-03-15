// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @title FHE Token Contract
/// @author Gimzou
/// @notice A confidential ERC7984 token for payroll payments
contract FHEToken is ZamaEthereumConfig, ERC7984, Ownable2Step {
    /// @notice Constructor for FHEToken
    /// @param owner The initial owner of the contract
    /// @param amount The initial supply to mint to the owner
    /// @param name_ The token name
    /// @param symbol_ The token symbol
    /// @param tokenURI_ The token metadata URI
    constructor(
        address owner,
        uint64 amount,
        string memory name_,
        string memory symbol_,
        string memory tokenURI_
    ) ERC7984(name_, symbol_, tokenURI_) Ownable(owner) {
        euint64 encryptedAmount = FHE.asEuint64(amount);
        _mint(owner, encryptedAmount);
    }
}
