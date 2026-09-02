#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, vec, Address, Env, IntoVal, Symbol,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    NextPoolId,
    PoolById(u32),
    PairToPool(PairKey),
}

#[derive(Clone)]
#[contracttype]
pub struct PairKey {
    pub token_in: Address,
    pub token_out: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RouterError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    PairNotFound = 4,
}

#[contract]
pub struct DexRouterContract;

#[contractimpl]
impl DexRouterContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(&env, RouterError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextPoolId, &1_u32);
    }

    pub fn register_pool(env: Env, token_a: Address, token_b: Address, pool_contract: Address) -> u32 {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let next: u32 = env.storage().instance().get(&DataKey::NextPoolId).unwrap_or(1);
        env.storage().instance().set(&DataKey::PoolById(next), &pool_contract);
        env.storage().instance().set(
            &DataKey::PairToPool(PairKey {
                token_in: token_a.clone(),
                token_out: token_b.clone(),
            }),
            &next,
        );
        env.storage().instance().set(
            &DataKey::PairToPool(PairKey {
                token_in: token_b.clone(),
                token_out: token_a.clone(),
            }),
            &next,
        );
        env.storage().instance().set(&DataKey::NextPoolId, &(next + 1));
        env.events().publish(
            (Symbol::new(&env, "register_pool"), next),
            (token_a, token_b, pool_contract),
        );
        next
    }

    pub fn quote_exact_in(env: Env, token_in: Address, token_out: Address, amount_in: i128) -> i128 {
        let pool = Self::get_pool_for_pair(env.clone(), token_in.clone(), token_out);
        env.invoke_contract::<i128>(
            &pool,
            &Symbol::new(&env, "quote_in"),
            vec![&env, token_in.into_val(&env), amount_in.into_val(&env)],
        )
    }

    pub fn swap_exact_in(
        env: Env,
        user: Address,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_out: i128,
    ) -> i128 {
        user.require_auth();
        let pool = Self::get_pool_for_pair(env.clone(), token_in.clone(), token_out);
        let out = env.invoke_contract::<i128>(
            &pool,
            &Symbol::new(&env, "swap_in"),
            vec![
                &env,
                user.clone().into_val(&env),
                token_in.into_val(&env),
                amount_in.into_val(&env),
                min_out.into_val(&env),
            ],
        );
        env.events()
            .publish((Symbol::new(&env, "router_swap"), user, pool), out);
        out
    }

    pub fn get_pool_for_pair(env: Env, token_in: Address, token_out: Address) -> Address {
        let pool_id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PairToPool(PairKey { token_in, token_out }))
            .unwrap_or(0);
        if pool_id == 0 {
            panic_with_error!(&env, RouterError::PairNotFound);
        }
        env.storage()
            .instance()
            .get(&DataKey::PoolById(pool_id))
            .unwrap()
    }
}

