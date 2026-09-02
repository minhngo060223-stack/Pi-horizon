#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    Plan(u32),
    Subscription(SubscriptionKey),
}

#[derive(Clone)]
#[contracttype]
pub struct Plan {
    pub id: u32,
    pub price: i128,
    pub period_ledgers: u32,
    pub receiver: Address,
    pub active: bool,
}

#[derive(Clone)]
#[contracttype]
pub struct SubscriptionKey {
    pub user: Address,
    pub plan_id: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct Subscription {
    pub user: Address,
    pub plan_id: u32,
    pub start_ledger: u32,
    pub next_renewal_ledger: u32,
    pub active: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SubscriptionError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    PlanNotFound = 4,
    PlanInactive = 5,
}

#[contract]
pub struct SubscriptionContract;

#[contractimpl]
impl SubscriptionContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(&env, SubscriptionError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn create_plan(env: Env, plan_id: u32, price: i128, period_ledgers: u32, receiver: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let plan = Plan {
            id: plan_id,
            price,
            period_ledgers,
            receiver,
            active: true,
        };
        env.storage().persistent().set(&DataKey::Plan(plan_id), &plan);
        env.events()
            .publish((Symbol::new(&env, "create_plan"), plan_id), (price, period_ledgers));
    }

    pub fn set_plan_active(env: Env, plan_id: u32, active: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut plan: Plan = env
            .storage()
            .persistent()
            .get(&DataKey::Plan(plan_id))
            .unwrap_or_else(|| panic_with_error!(&env, SubscriptionError::PlanNotFound));
        plan.active = active;
        env.storage().persistent().set(&DataKey::Plan(plan_id), &plan);
    }

    pub fn subscribe(env: Env, user: Address, plan_id: u32, start_ledger: u32) {
        user.require_auth();
        let plan: Plan = env
            .storage()
            .persistent()
            .get(&DataKey::Plan(plan_id))
            .unwrap_or_else(|| panic_with_error!(&env, SubscriptionError::PlanNotFound));
        if !plan.active {
            panic_with_error!(&env, SubscriptionError::PlanInactive);
        }

        let sub = Subscription {
            user: user.clone(),
            plan_id,
            start_ledger,
            next_renewal_ledger: start_ledger + plan.period_ledgers,
            active: true,
        };
        env.storage().persistent().set(
            &DataKey::Subscription(SubscriptionKey {
                user: user.clone(),
                plan_id,
            }),
            &sub,
        );
        env.events()
            .publish((Symbol::new(&env, "subscribe"), user, plan_id), sub.next_renewal_ledger);
    }

    pub fn cancel(env: Env, user: Address, plan_id: u32) {
        user.require_auth();
        let key = DataKey::Subscription(SubscriptionKey {
            user: user.clone(),
            plan_id,
        });
        let mut sub: Subscription = env.storage().persistent().get(&key).unwrap_or(Subscription {
            user,
            plan_id,
            start_ledger: 0,
            next_renewal_ledger: 0,
            active: false,
        });
        sub.active = false;
        env.storage().persistent().set(&key, &sub);
    }

    pub fn is_active(env: Env, user: Address, plan_id: u32, current_ledger: u32) -> bool {
        let key = DataKey::Subscription(SubscriptionKey { user, plan_id });
        let sub: Option<Subscription> = env.storage().persistent().get(&key);
        match sub {
            Some(s) => s.active && current_ledger <= s.next_renewal_ledger,
            None => false,
        }
    }

    pub fn get_plan(env: Env, plan_id: u32) -> Option<Plan> {
        env.storage().persistent().get(&DataKey::Plan(plan_id))
    }

    pub fn get_subscription(env: Env, user: Address, plan_id: u32) -> Option<Subscription> {
        env.storage()
            .persistent()
            .get(&DataKey::Subscription(SubscriptionKey { user, plan_id }))
    }
}

