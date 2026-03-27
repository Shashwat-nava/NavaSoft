package detectionpb

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const ServiceName = "detection.DetectionService"

const (
	Detect_FullMethodName       = "/" + ServiceName + "/Detect"
	DetectStream_FullMethodName = "/" + ServiceName + "/DetectStream"
	Health_FullMethodName       = "/" + ServiceName + "/Health"
)

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

type DetectionServiceServer interface {
	Detect(context.Context, *DetectRequest) (*DetectResponse, error)
	DetectStream(DetectionService_DetectStreamServer) error
	Health(context.Context, *HealthRequest) (*HealthResponse, error)
}

type UnimplementedDetectionServiceServer struct{}

func (UnimplementedDetectionServiceServer) Detect(context.Context, *DetectRequest) (*DetectResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "Detect not implemented")
}
func (UnimplementedDetectionServiceServer) DetectStream(DetectionService_DetectStreamServer) error {
	return status.Errorf(codes.Unimplemented, "DetectStream not implemented")
}
func (UnimplementedDetectionServiceServer) Health(context.Context, *HealthRequest) (*HealthResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "Health not implemented")
}

func RegisterDetectionServiceServer(s grpc.ServiceRegistrar, srv DetectionServiceServer) {
	s.RegisterService(&_DetectionService_serviceDesc, srv)
}

// ---------------------------------------------------------------------------
// Unary handlers
// ---------------------------------------------------------------------------

func _Detect_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(DetectRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DetectionServiceServer).Detect(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: Detect_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DetectionServiceServer).Detect(ctx, req.(*DetectRequest))
	})
}

func _Health_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(HealthRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DetectionServiceServer).Health(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: Health_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DetectionServiceServer).Health(ctx, req.(*HealthRequest))
	})
}

// ---------------------------------------------------------------------------
// Streaming handler
// ---------------------------------------------------------------------------

func _DetectStream_Handler(srv interface{}, stream grpc.ServerStream) error {
	return srv.(DetectionServiceServer).DetectStream(&detectStreamServerWrap{stream})
}

type DetectionService_DetectStreamServer interface {
	Send(*DetectResponse) error
	Recv() (*DetectRequest, error)
	grpc.ServerStream
}

type detectStreamServerWrap struct{ grpc.ServerStream }

func (x *detectStreamServerWrap) Send(m *DetectResponse) error {
	return x.ServerStream.SendMsg(m)
}
func (x *detectStreamServerWrap) Recv() (*DetectRequest, error) {
	m := new(DetectRequest)
	if err := x.ServerStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// Service descriptor
// ---------------------------------------------------------------------------

var _DetectionService_serviceDesc = grpc.ServiceDesc{
	ServiceName: ServiceName,
	HandlerType: (*DetectionServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{MethodName: "Detect", Handler: _Detect_Handler},
		{MethodName: "Health", Handler: _Health_Handler},
	},
	Streams: []grpc.StreamDesc{
		{
			StreamName:    "DetectStream",
			Handler:       _DetectStream_Handler,
			ServerStreams:  true,
			ClientStreams:  true,
		},
	},
	Metadata: "detection.proto",
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type DetectionServiceClient interface {
	Detect(ctx context.Context, in *DetectRequest, opts ...grpc.CallOption) (*DetectResponse, error)
	DetectStream(ctx context.Context, opts ...grpc.CallOption) (DetectionService_DetectStreamClient, error)
	Health(ctx context.Context, in *HealthRequest, opts ...grpc.CallOption) (*HealthResponse, error)
}

type detectionServiceClient struct{ cc grpc.ClientConnInterface }

func NewDetectionServiceClient(cc grpc.ClientConnInterface) DetectionServiceClient {
	return &detectionServiceClient{cc}
}

func (c *detectionServiceClient) Detect(ctx context.Context, in *DetectRequest, opts ...grpc.CallOption) (*DetectResponse, error) {
	out := new(DetectResponse)
	if err := c.cc.Invoke(ctx, Detect_FullMethodName, in, out, opts...); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *detectionServiceClient) Health(ctx context.Context, in *HealthRequest, opts ...grpc.CallOption) (*HealthResponse, error) {
	out := new(HealthResponse)
	if err := c.cc.Invoke(ctx, Health_FullMethodName, in, out, opts...); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *detectionServiceClient) DetectStream(ctx context.Context, opts ...grpc.CallOption) (DetectionService_DetectStreamClient, error) {
	desc := &_DetectionService_serviceDesc.Streams[0]
	stream, err := c.cc.NewStream(ctx, desc, DetectStream_FullMethodName, opts...)
	if err != nil {
		return nil, err
	}
	return &detectStreamClientWrap{stream}, nil
}

type DetectionService_DetectStreamClient interface {
	Send(*DetectRequest) error
	Recv() (*DetectResponse, error)
	grpc.ClientStream
}

type detectStreamClientWrap struct{ grpc.ClientStream }

func (x *detectStreamClientWrap) Send(m *DetectRequest) error {
	return x.ClientStream.SendMsg(m)
}
func (x *detectStreamClientWrap) Recv() (*DetectResponse, error) {
	m := new(DetectResponse)
	if err := x.ClientStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}
