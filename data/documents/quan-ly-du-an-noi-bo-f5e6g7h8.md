# Quản Lý Dự Án Nội Bộ

## 1. Tổng quan quy trình

Quy trình quản lý dự án nội bộ áp dụng cho tất cả các dự án công nghệ thông tin, xây dựng, và triển khai phần mềm do công ty thực hiện. Mỗi dự án phải được phê duyệt ngân sách trước khi bắt đầu.

## 2. Khởi tạo dự án

### 2.1 Đề xuất dự án

Bất kỳ nhân viên nào cũng có thể đề xuất dự án mới bằng cách:
1. Điền form "Đề xuất dự án" trên hệ thống ERP
2. Mô tả mục tiêu, phạm vi, thời gian dự kiến, và ngân sách ước tính
3. Gắn với OKR hoặc chiến lược công ty
4. Gửi cho Trưởng phòng xem xét

### 2.2 Phê duyệt dự án

Ngưỡng phê duyệt dự án theo ngân sách:

| Ngân sách | Người phê duyệt | SLA phê duyệt |
|---|---|---|
| < 50 triệu | Trưởng phòng | 3 ngày làm việc |
| 50-200 triệu | Phó Giám đốc | 5 ngày làm việc |
| 200 triệu - 1 tỷ | Giám đốc | 7 ngày làm việc |
| > 1 tỷ | HĐQT | 14 ngày làm việc |

Dự án bị từ chối phải có lý do bằng văn bản. Đề xuất者 có thể khiếu nại lên cấp trên trực tiếp trong 5 ngày.

## 3. Lập kế hoạch

### 3.1 Phân công nguồn lực

- Trưởng dự án phân công thành viên dựa trên kỹ năng và sẵn có
- Mỗi thành viên không được phân công quá **80% thời gian** vào 1 dự án
- Phòng HC-NS quản lý matrix phân công, cảnh báo quá tải

### 3.2 WBS và Timeline

- Chia dự án thành Work Breakdown Structure (WBS)
- Mỗi task có chủ nhiệm, deadline, và % completed
- Sử dụng Gantt chart trên ERP để theo dõi tiến độ
- Cập nhật trạng thái task mỗi ngày

### 3.3 Quản lý rủi ro

Mỗi dự án phải có bảng rủi ro với các cột:

| Mô tả rủi ro | Xác suất | Mức tác động | Phương án giảm thiểu | Người chịu trách nhiệm |
|---|---|---|---|---|
| (Ví dụ: Nhân sự nghỉ việc) | Cao/Trung bình/Thấp | Cao/Trung bình/Thấp | (Hành động giảm thiểu) | (Tên) |

Trưởng dự án cập nhật bảng rủi ro hàng tuần.

## 4. Thực thi dự án

### 4.1 Standup meeting

- Hàng ngày, 15 phút, thời gian do team tự quyết
- 3 câu hỏi: Hôm qua làm gì? Hôm nay làm gì? Có gì blocker không?
- Ghi nhận trên kênh Slack của dự án

### 4.2 Sprint review

- Mỗi 2 tuần, 1 giờ
- Demo sản phẩm phần đã hoàn thành cho stakeholder
- Thu feedback, cập nhật backlog

### 4.3 Quản lý thay đổi

Mọi thay đổi scope phải qua quy trình:
1. Điền form "Change Request"
2. Trưởng dự án đánh giá tác động (thời gian, chi phí, chất lượng)
3. Người phê duyệt dự án (theo ngưỡng) phê duyệt change request
4. Cập nhật WBS, timeline, ngân sách

Thay đổi scope < 10% ngân sách: Trưởng phòng duyệt
Thay đổi scope 10-30%: Phó Giám đốc duyệt
Thay đổi scope > 30%: Giám đốc duyệt

## 5. Đóng dự án

### 5.1 Bàn giao

- Bàn giao sản phẩm cho bộ phận tiếp nhận
- Kiểm tra acceptance criteria đã đáp ứng đầy đủ
- Ký biên bản bàn giao

### 5.2 Post-mortem

- Tổng kết dự án trong 7 ngày sau khi đóng
- Phân tích: gì làm tốt, gì cần cải thiện, bài học kinh nghiệm
- Gửi báo cáo cho Giám đốc và Phòng HC-NS

### 5.3 Giải phóng nguồn lực

- Trưởng dự án trả thành viên về pool sẵn có
- Cập nhật trạng thái sẵn có trên ERP
- Phòng HC-NS điều phối thành viên sang dự án mới