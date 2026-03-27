package detectionpb

import (
	"encoding/json"

	"google.golang.org/grpc/encoding"
)

func init() {
	encoding.RegisterCodec(JSONCodec{})
}

// JSONCodec implements gRPC's encoding.Codec using JSON serialization.
// Registered as "json"; the client uses grpc.ForceCodec to select it.
type JSONCodec struct{}

func (JSONCodec) Marshal(v interface{}) ([]byte, error)      { return json.Marshal(v) }
func (JSONCodec) Unmarshal(data []byte, v interface{}) error  { return json.Unmarshal(data, v) }
func (JSONCodec) Name() string                               { return "json" }
