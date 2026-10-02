package ledgerkey

import (
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/stellar/go-stellar-sdk/strkey"
	"github.com/stellar/go-stellar-sdk/xdr"
)

// MaxKeyMemoryBytes bounds decoding of caller-supplied ledger keys.
const MaxKeyMemoryBytes = 16 * 1024

// Durability is the contract-data durability class of a ledger key.
// Pi's LedgerKeyContractData carries this explicitly, unlike upstream Stellar.
type Durability string

const (
	DurabilityPersistent Durability = "persistent"
	DurabilityTemporary  Durability = "temporary"
)

func parseDurability(s string) (xdr.ContractDataDurability, error) {
	switch strings.ToLower(s) {
	case "", string(DurabilityPersistent):
		return xdr.ContractDataDurabilityPersistent, nil
	case string(DurabilityTemporary):
		return xdr.ContractDataDurabilityTemporary, nil
	default:
		return 0, fmt.Errorf("unknown durability %q, expected persistent or temporary", s)
	}
}

func contractAddress(id string) (xdr.ScAddress, error) {
	raw, err := strkey.Decode(strkey.VersionByteContract, id)
	if err != nil {
		return xdr.ScAddress{}, fmt.Errorf("invalid contract id %q: %w", id, err)
	}
	var cid xdr.ContractId
	copy(cid[:], raw)
	return xdr.ScAddress{Type: xdr.ScAddressTypeScAddressTypeContract, ContractId: &cid}, nil
}

func accountAddress(id string) (xdr.AccountId, error) {
	raw, err := strkey.Decode(strkey.VersionByteAccountID, id)
	if err != nil {
		return xdr.AccountId{}, fmt.Errorf("invalid account id %q: %w", id, err)
	}
	var pk xdr.Uint256
	copy(pk[:], raw)
	return xdr.AccountId{Type: xdr.PublicKeyTypePublicKeyTypeEd25519, Ed25519: &pk}, nil
}

func symbolVal(name string) (xdr.ScVal, error) {
	sym := xdr.ScSymbol(name)
	if len(name) > 32 {
		return xdr.ScVal{}, fmt.Errorf("symbol %q exceeds 32 characters", name)
	}
	return xdr.ScVal{Type: xdr.ScValTypeScvSymbol, Sym: &sym}, nil
}

func contractDataKey(contract string, key xdr.ScVal, durability xdr.ContractDataDurability) (xdr.LedgerKey, error) {
	addr, err := contractAddress(contract)
	if err != nil {
		return xdr.LedgerKey{}, err
	}
	return xdr.LedgerKey{
		Type: xdr.LedgerEntryTypeContractData,
		ContractData: &xdr.LedgerKeyContractData{
			Contract:   addr,
			Key:        key,
			Durability: durability,
		},
	}, nil
}

// Parse accepts either a raw base64 XDR LedgerKey or one of the shorthand forms:
//
//	ledgerKey:<base64 XDR>            passthrough to base64 XDR decoding
//	account:<G...>                   account entry
//	contract:<C...>                  contract instance storage (persistent)
//	contractCode:<C...>              contract WASM code, keyed by hash
//	contractInstance:<C...>[:<dur>]  the contract instance storage entry
//	contractDataSymbol:<C...>:<name>[:<dur>]  a symbol-keyed storage entry
//	contractData:<C...>:<base64 ScVal>[:<dur>]  any storage key
//
// Anything without a recognised prefix is treated as raw base64 XDR, which keeps
// existing clients working.
func Parse(key string, decodeOptions xdr.DecodeOptions) (xdr.LedgerKey, error) {
	prefix, rest, found := strings.Cut(key, ":")
	if !found {
		return unmarshalBase64(key, decodeOptions)
	}

	switch prefix {
	case "ledgerKey":
		return unmarshalBase64(rest, decodeOptions)

	case "account":
		aid, err := accountAddress(rest)
		if err != nil {
			return xdr.LedgerKey{}, err
		}
		return xdr.LedgerKey{
			Type:    xdr.LedgerEntryTypeAccount,
			Account: &xdr.LedgerKeyAccount{AccountId: aid},
		}, nil

	case "contract", "contractInstance":
		parts := strings.Split(rest, ":")
		dur, err := parseDurability(parts[len(parts)-1])
		if len(parts) == 2 {
			dur, err = parseDurability(parts[1])
		} else if err != nil {
			dur, err = parseDurability("")
		}
		if err != nil {
			return xdr.LedgerKey{}, err
		}
		return contractDataKey(parts[0],
			xdr.ScVal{Type: xdr.ScValTypeScvLedgerKeyContractInstance}, dur)

	case "contractCode":
		addr, err := contractAddress(rest)
		if err != nil {
			return xdr.LedgerKey{}, err
		}
		cid := addr.MustContractId()
		var hash xdr.Hash = xdr.Hash(cid)
		return xdr.LedgerKey{
			Type:         xdr.LedgerEntryTypeContractCode,
			ContractCode: &xdr.LedgerKeyContractCode{Hash: hash},
		}, nil

	case "contractDataSymbol":
		parts := strings.Split(rest, ":")
		if len(parts) < 2 {
			return xdr.LedgerKey{}, fmt.Errorf("contractDataSymbol expects <contractId>:<symbol>[:<durability>]")
		}
		dur := ""
		if len(parts) >= 3 {
			dur = parts[2]
		}
		d, err := parseDurability(dur)
		if err != nil {
			return xdr.LedgerKey{}, err
		}
		sv, err := symbolVal(parts[1])
		if err != nil {
			return xdr.LedgerKey{}, err
		}
		return contractDataKey(parts[0], sv, d)

	case "contractData":
		// The ScVal may itself contain ':' padding-safe base64, so only treat the
		// final segment as durability when it names a known class.
		parts := strings.Split(rest, ":")
		if len(parts) < 2 {
			return xdr.LedgerKey{}, fmt.Errorf("contractData expects <contractId>:<base64 ScVal>[:<durability>]")
		}
		dur := ""
		if len(parts) >= 3 {
			last := parts[len(parts)-1]
			if strings.EqualFold(last, string(DurabilityPersistent)) ||
				strings.EqualFold(last, string(DurabilityTemporary)) {
				dur = last
				parts = parts[:len(parts)-1]
			}
		}
		d, err := parseDurability(dur)
		if err != nil {
			return xdr.LedgerKey{}, err
		}
		raw, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return xdr.LedgerKey{}, fmt.Errorf("contract data key is not valid base64: %w", err)
		}
		var sv xdr.ScVal
		if err := xdr.SafeUnmarshal(raw, &sv); err != nil {
			return xdr.LedgerKey{}, fmt.Errorf("cannot decode storage key ScVal: %w", err)
		}
		return contractDataKey(parts[0], sv, d)

	default:
		return unmarshalBase64(key, decodeOptions)
	}
}

func unmarshalBase64(key string, decodeOptions xdr.DecodeOptions) (xdr.LedgerKey, error) {
	var ledgerKey xdr.LedgerKey
	if err := xdr.SafeUnmarshalBase64WithOptions(key, &ledgerKey, decodeOptions); err != nil {
		return xdr.LedgerKey{}, err
	}
	return ledgerKey, nil
}
