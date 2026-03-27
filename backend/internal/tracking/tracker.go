package tracking

import "math"

// ByteTrack: Multi-Object Tracking by Associating Every Detection Box
// Reference: https://arxiv.org/abs/2110.06864
//
// Two-stage association:
//   1. Match high-confidence detections to active tracks
//   2. Match remaining low-confidence detections to still-unmatched tracks
// This recovers objects that are temporarily occluded or blurred (low score)
// instead of discarding them.

const (
	highScoreThresh = 0.5  // split detections into high / low confidence
	matchIoUThresh  = 0.25 // minimum IoU for a valid association
	maxLostFrames   = 10   // keep lost tracks this many frames before removal
	confirmAfter    = 3    // tentative → confirmed after N consecutive matches
	velocityAlpha   = 0.4  // EMA smoothing for motion velocity
)

type Detection struct {
	Label      string     `json:"label"`
	Box        [4]float64 `json:"box"` // x, y, w, h normalized
	Confidence float64    `json:"confidence"`
}

type trackState int

const (
	tentative trackState = iota
	confirmed
	lost
)

type strack struct {
	id         int
	label      string
	state      trackState
	box        [4]float64
	confidence float64
	age        int
	hitStreak  int
	lostFrames int

	vx, vy, vw, vh float64
}

func (s *strack) predict() {
	s.box[0] += s.vx
	s.box[1] += s.vy
	s.box[2] += s.vw
	s.box[3] += s.vh

	if s.box[2] < 0.001 {
		s.box[2] = 0.001
	}
	if s.box[3] < 0.001 {
		s.box[3] = 0.001
	}
}

func (s *strack) update(det Detection) {
	a := velocityAlpha
	s.vx = a*(det.Box[0]-s.box[0]) + (1-a)*s.vx
	s.vy = a*(det.Box[1]-s.box[1]) + (1-a)*s.vy
	s.vw = a*(det.Box[2]-s.box[2]) + (1-a)*s.vw
	s.vh = a*(det.Box[3]-s.box[3]) + (1-a)*s.vh

	s.box = det.Box
	s.confidence = det.Confidence
	s.lostFrames = 0
	s.hitStreak++
	s.age++
}

func (s *strack) markLost() {
	s.state = lost
	s.lostFrames++
	s.hitStreak = 0
}

// Track is the public output returned to the caller.
type Track struct {
	ID         int        `json:"id"`
	Label      string     `json:"label"`
	Box        [4]float64 `json:"box"`
	Confidence float64    `json:"confidence"`
	Active     bool       `json:"active"`
	Age        int        `json:"age"`
}

type Tracker struct {
	nextID int
	active []*strack
	lost   []*strack
}

func NewTracker() *Tracker {
	return &Tracker{nextID: 1}
}

// Update runs one ByteTrack cycle and returns currently visible tracks.
func (t *Tracker) Update(detections []Detection) []Track {
	// --- 0. Predict next position for every tracked object ---
	for _, s := range t.active {
		s.predict()
	}
	for _, s := range t.lost {
		s.predict()
	}

	// --- 1. Split detections by confidence ---
	var highDets, lowDets []Detection
	for _, d := range detections {
		if d.Confidence >= highScoreThresh {
			highDets = append(highDets, d)
		} else {
			lowDets = append(lowDets, d)
		}
	}

	// --- 2. First association: high-conf dets ↔ active tracks ---
	matchedT1, matchedD1, unmatchedT1, unmatchedD1 := associate(t.active, highDets)

	for i, ti := range matchedT1 {
		t.active[ti].update(highDets[matchedD1[i]])
		if t.active[ti].hitStreak >= confirmAfter && t.active[ti].state == tentative {
			t.active[ti].state = confirmed
		}
	}

	// --- 3. Second association: low-conf dets ↔ remaining unmatched active tracks ---
	remainTracks := gatherPtrs(t.active, unmatchedT1)

	matchedT2, matchedD2, stillUnmatched, _ := associate(remainTracks, lowDets)

	for i, ti := range matchedT2 {
		remainTracks[ti].update(lowDets[matchedD2[i]])
		if remainTracks[ti].hitStreak >= confirmAfter && remainTracks[ti].state == tentative {
			remainTracks[ti].state = confirmed
		}
	}

	// --- 4. Handle unmatched active tracks ---
	removeIDs := make(map[int]bool)
	for _, idx := range stillUnmatched {
		s := remainTracks[idx]
		if s.state == tentative {
			// Unmatched tentative → remove immediately
			removeIDs[s.id] = true
		} else {
			s.markLost()
			t.lost = append(t.lost, s)
			removeIDs[s.id] = true
		}
	}

	// --- 5. Try to recover lost tracks with unmatched high-conf dets ---
	// Map unmatchedD1 indices back to actual Detection values
	unmatchedHighDets := gatherDets(highDets, unmatchedD1)
	var finalNewDets []Detection

	if len(unmatchedHighDets) > 0 && len(t.lost) > 0 {
		recMatchT, recMatchD, recUnmatchT, recUnmatchD := associate(t.lost, unmatchedHighDets)

		for i, ti := range recMatchT {
			t.lost[ti].update(unmatchedHighDets[recMatchD[i]])
			t.lost[ti].state = confirmed
			t.active = append(t.active, t.lost[ti])
		}

		// Mark recovered lost tracks for removal from t.lost
		recovered := make(map[int]bool)
		for _, ti := range recMatchT {
			recovered[ti] = true
		}

		// Age remaining lost tracks
		var newLost []*strack
		for i, s := range t.lost {
			if recovered[i] {
				continue
			}
			isUnmatched := false
			for _, ti := range recUnmatchT {
				if ti == i {
					isUnmatched = true
					break
				}
			}
			if isUnmatched {
				s.lostFrames++
				if s.lostFrames <= maxLostFrames {
					newLost = append(newLost, s)
				}
			}
		}
		t.lost = newLost

		// Collect truly unmatched high-conf dets for new track creation
		finalNewDets = gatherDets(unmatchedHighDets, recUnmatchD)
	} else {
		// No lost recovery attempt — age out lost tracks
		var newLost []*strack
		for _, s := range t.lost {
			s.lostFrames++
			if s.lostFrames <= maxLostFrames {
				newLost = append(newLost, s)
			}
		}
		t.lost = newLost
		finalNewDets = unmatchedHighDets
	}

	// --- 6. Create new tentative tracks from truly unmatched high-conf dets ---
	for _, d := range finalNewDets {
		s := &strack{
			id:         t.nextID,
			label:      d.Label,
			state:      tentative,
			box:        d.Box,
			confidence: d.Confidence,
			age:        1,
			hitStreak:  1,
		}
		t.nextID++
		t.active = append(t.active, s)
	}

	// --- 7. Purge removed/lost tracks from active list ---
	filtered := t.active[:0]
	for _, s := range t.active {
		if !removeIDs[s.id] {
			filtered = append(filtered, s)
		}
	}
	t.active = filtered

	// --- 8. Emit confirmed tracks only ---
	result := make([]Track, 0, len(t.active))
	for _, s := range t.active {
		if s.state == tentative {
			continue
		}
		result = append(result, Track{
			ID:         s.id,
			Label:      s.label,
			Box:        s.box,
			Confidence: s.confidence,
			Active:     true,
			Age:        s.age,
		})
	}
	return result
}

// associate performs greedy IoU matching between tracks and detections.
func associate(tracks []*strack, dets []Detection) (matchedT, matchedD, unmatchedT, unmatchedD []int) {
	if len(tracks) == 0 || len(dets) == 0 {
		unmatchedT = seq(len(tracks))
		unmatchedD = seq(len(dets))
		return
	}

	costs := make([][]float64, len(tracks))
	for i, tr := range tracks {
		costs[i] = make([]float64, len(dets))
		for j, d := range dets {
			if tr.label == d.Label {
				costs[i][j] = iou(tr.box, d.Box)
			}
		}
	}

	usedT := make([]bool, len(tracks))
	usedD := make([]bool, len(dets))

	for {
		bestI, bestJ := -1, -1
		bestVal := matchIoUThresh
		for i := range tracks {
			if usedT[i] {
				continue
			}
			for j := range dets {
				if usedD[j] {
					continue
				}
				if costs[i][j] > bestVal {
					bestVal = costs[i][j]
					bestI = i
					bestJ = j
				}
			}
		}
		if bestI < 0 {
			break
		}
		matchedT = append(matchedT, bestI)
		matchedD = append(matchedD, bestJ)
		usedT[bestI] = true
		usedD[bestJ] = true
	}

	for i := range tracks {
		if !usedT[i] {
			unmatchedT = append(unmatchedT, i)
		}
	}
	for j := range dets {
		if !usedD[j] {
			unmatchedD = append(unmatchedD, j)
		}
	}
	return
}

func gatherPtrs(tracks []*strack, indices []int) []*strack {
	out := make([]*strack, len(indices))
	for i, idx := range indices {
		out[i] = tracks[idx]
	}
	return out
}

func gatherDets(dets []Detection, indices []int) []Detection {
	out := make([]Detection, len(indices))
	for i, idx := range indices {
		out[i] = dets[idx]
	}
	return out
}

func seq(n int) []int {
	s := make([]int, n)
	for i := range s {
		s[i] = i
	}
	return s
}

func iou(a, b [4]float64) float64 {
	x1 := math.Max(a[0], b[0])
	y1 := math.Max(a[1], b[1])
	x2 := math.Min(a[0]+a[2], b[0]+b[2])
	y2 := math.Min(a[1]+a[3], b[1]+b[3])
	if x2 <= x1 || y2 <= y1 {
		return 0
	}
	inter := (x2 - x1) * (y2 - y1)
	areaA := a[2] * a[3]
	areaB := b[2] * b[3]
	union := areaA + areaB - inter
	if union <= 0 {
		return 0
	}
	return inter / union
}
