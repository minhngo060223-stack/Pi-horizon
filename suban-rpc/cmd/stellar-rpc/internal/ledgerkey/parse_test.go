package ledgerkey

import (
	"testing"

	"github.com/stellar/go-stellar-sdk/xdr"
)

func decodeOpts() xdr.DecodeOptions { return xdr.DecodeOptions{MaxMemoryBytes: MaxKeyMemoryBytes} }

func TestParseAccountShorthand(t *testing.T) {
	const addr = "GAVRTDGVIRBQTNX5AWZPH2PRIS43HQ5WW2N4CGS426SOBC2EXPTKOHJF"
	k, err := Parse("account:"+addr, decodeOpts())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if k.Type != xdr.LedgerEntryTypeAccount {
		t.Fatalf("expected account entry, got %v", k.Type)
	}
	if k.Account == nil {
		t.Fatal("account id missing")
	}
}

func TestParseContractInstance(t *testing.T) {
	const contract = "CDG6ZM2SHXIHD5HZ2E62B7D76RY5DUHDNQVPSHRVDNN7W4EW47FXLEXQ"
	for _, tc := range []struct {
		in   string
		want xdr.ContractDataDurability
	}{
		{"contract:" + contract, xdr.ContractDataDurabilityPersistent},
		{"contractInstance:" + contract, xdr.ContractDataDurabilityPersistent},
		{"contractInstance:" + contract + ":temporary", xdr.ContractDataDurabilityTemporary},
		{"contractInstance:" + contract + ":persistent", xdr.ContractDataDurabilityPersistent},
	} {
		k, err := Parse(tc.in, decodeOpts())
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", tc.in, err)
		}
		if k.Type != xdr.LedgerEntryTypeContractData {
			t.Fatalf("%s: expected contract data, got %v", tc.in, k.Type)
		}
		if k.ContractData.Durability != tc.want {
			t.Fatalf("%s: durability = %v, want %v", tc.in, k.ContractData.Durability, tc.want)
		}
		if k.ContractData.Key.Type != xdr.ScValTypeScvLedgerKeyContractInstance {
			t.Fatalf("%s: expected instance key, got %v", tc.in, k.ContractData.Key.Type)
		}
	}
}

func TestParseContractDataSymbol(t *testing.T) {
	const contract = "CDG6ZM2SHXIHD5HZ2E62B7D76RY5DUHDNQVPSHRVDNN7W4EW47FXLEXQ"
	k, err := Parse("contractDataSymbol:"+contract+":balance", decodeOpts())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if k.ContractData.Key.Type != xdr.ScValTypeScvSymbol {
		t.Fatalf("expected symbol key, got %v", k.ContractData.Key.Type)
	}
	if got := string(*k.ContractData.Key.Sym); got != "balance" {
		t.Fatalf("symbol = %q, want balance", got)
	}
	if k.ContractData.Durability != xdr.ContractDataDurabilityPersistent {
		t.Fatalf("default durability should be persistent, got %v", k.ContractData.Durability)
	}
}

func TestParseContractDataSymbolTemporary(t *testing.T) {
	const contract = "CDG6ZM2SHXIHD5HZ2E62B7D76RY5DUHDNQVPSHRVDNN7W4EW47FXLEXQ"
	k, err := Parse("contractDataSymbol:"+contract+":counter:temporary", decodeOpts())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if k.ContractData.Durability != xdr.ContractDataDurabilityTemporary {
		t.Fatalf("expected temporary durability, got %v", k.ContractData.Durability)
	}
}

func TestParseRejectsBadInput(t *testing.T) {
	for _, in := range []string{
		"account:notanaccount",
		"contract:NOTACONTRACT",
		"contractDataSymbol:CDG6ZM2SHXIHD5HZ2E62B7D76RY5DUHDNQVPSHRVDNN7W4EW47FXLEXQ",
		"contractInstance:CDG6ZM2SHXIHD5HZ2E62B7D76RY5DUHDNQVPSHRVDNN7W4EW47FXLEXQ:bogus",
	} {
		if _, err := Parse(in, decodeOpts()); err == nil {
			t.Fatalf("expected error for %q", in)
		}
	}
}

// A raw base64 XDR key must keep working, since that is what the RPC accepted
// before shorthand forms were added.
func TestParseRawBase64StillWorks(t *testing.T) {
	const rawKey = "AAAAAAAAAAArGYzVREMJtv0FsvPp8US5s8O2tpvBGlzXpOCLRLvmpw=="
	for _, in := range []string{rawKey, "ledgerKey:" + rawKey} {
		k, err := Parse(in, decodeOpts())
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", in, err)
		}
		if k.Type != xdr.LedgerEntryTypeAccount {
			t.Fatalf("%s: expected account entry, got %v", in, k.Type)
		}
	}
}
