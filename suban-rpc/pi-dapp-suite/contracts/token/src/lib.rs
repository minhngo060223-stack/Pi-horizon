#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, String, Symbol,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    Name,
    Symbol,
    Decimals,
    TotalSupply,
    Balance(Address),
    Allowance(AllowanceKey),
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceKey {
    pub owner: Address,
    pub spender: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InsufficientBalance = 4,
    InsufficientAllowance = 5,
}

fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

fn require_initialized(env: &Env) {
    if !is_initialized(env) {
        panic_with_error!(env, TokenError::NotInitialized);
    }
}

fn read_balance(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(addr.clone()))
        .unwrap_or(0)
}

fn write_balance(env: &Env, addr: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(addr.clone()), &amount);
}

fn read_allowance(env: &Env, owner: &Address, spender: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Allowance(AllowanceKey {
            owner: owner.clone(),
            spender: spender.clone(),
        }))
        .unwrap_or(0)
}

fn write_allowance(env: &Env, owner: &Address, spender: &Address, amount: i128) {
    env.storage().persistent().set(
        &DataKey::Allowance(AllowanceKey {
            owner: owner.clone(),
            spender: spender.clone(),
        }),
        &amount,
    );
}

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    pub fn init(env: Env, admin: Address, name: String, symbol: String, decimals: u32) {
        if is_initialized(&env) {
            panic_with_error!(&env, TokenError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        require_initialized(&env);
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let next = read_balance(&env, &to) + amount;
        write_balance(&env, &to, next);
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + amount));

        env.events().publish((Symbol::new(&env, "mint"), to), amount);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        require_initialized(&env);
        from.require_auth();

        let from_bal = read_balance(&env, &from);
        if from_bal < amount {
            panic_with_error!(&env, TokenError::InsufficientBalance);
        }
        write_balance(&env, &from, from_bal - amount);
        write_balance(&env, &to, read_balance(&env, &to) + amount);
        env.events()
            .publish((Symbol::new(&env, "transfer"), from, to), amount);
    }

    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128) {
        require_initialized(&env);
        owner.require_auth();
        write_allowance(&env, &owner, &spender, amount);
        env.events()
            .publish((Symbol::new(&env, "approve"), owner, spender), amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        require_initialized(&env);
        spender.require_auth();

        let allowance = read_allowance(&env, &from, &spender);
        if allowance < amount {
            panic_with_error!(&env, TokenError::InsufficientAllowance);
        }
        let from_bal = read_balance(&env, &from);
        if from_bal < amount {
            panic_with_error!(&env, TokenError::InsufficientBalance);
        }

        write_allowance(&env, &from, &spender, allowance - amount);
        write_balance(&env, &from, from_bal - amount);
        write_balance(&env, &to, read_balance(&env, &to) + amount);
        env.events()
            .publish((Symbol::new(&env, "transfer_from"), spender, from, to), amount);
    }

    pub fn balance(env: Env, owner: Address) -> i128 {
        read_balance(&env, &owner)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        read_allowance(&env, &owner, &spender)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn metadata(env: Env) -> (String, String, u32) {
        (
            env.storage().instance().get(&DataKey::Name).unwrap(),
            env.storage().instance().get(&DataKey::Symbol).unwrap(),
            env.storage().instance().get(&DataKey::Decimals).unwrap_or(0),
        )
    }
}

